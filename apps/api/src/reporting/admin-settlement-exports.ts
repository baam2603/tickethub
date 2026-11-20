import { randomUUID } from "node:crypto";
import {
  ConflictException,
  GoneException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../database/db";
import { adminSettlementExports as jobs, users } from "../database/schema";
import {
  readAdminSettlementReport,
  renderAdminSettlementDownload,
  type AdminSettlementExportQuery,
} from "./admin-settlement-report";

const publicJob = {
  id: jobs.id,
  status: jobs.status,
  query: jobs.query,
  createdAt: jobs.createdAt,
  expiresAt: jobs.expiresAt,
  errorCode: jobs.errorCode,
};

export async function enqueueAdminSettlementExport(
  adminId: string,
  query: AdminSettlementExportQuery,
) {
  return db.transaction(async (tx) => {
    const [admin] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, adminId),
          eq(users.status, "ACTIVE"),
          eq(users.role, "ADMIN"),
        ),
      )
      .for("update");
    if (!admin) throw new NotFoundException("ADMIN_NOT_FOUND");
    const pending = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.requestedBy, adminId),
          inArray(jobs.status, ["PENDING", "PROCESSING"]),
        ),
      );
    if (pending.length >= 3) throw new ConflictException("EXPORT_QUEUE_LIMIT");
    const [job] = await tx
      .insert(jobs)
      .values({ requestedBy: adminId, query })
      .returning(publicJob);
    return job!;
  });
}

export async function listAdminSettlementExports(
  adminId: string,
  page: number,
  limit: number,
) {
  const rows = await db
    .select(publicJob)
    .from(jobs)
    .where(eq(jobs.requestedBy, adminId))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(limit + 1)
    .offset((page - 1) * limit);
  return {
    items: rows.slice(0, limit),
    meta: { page, limit, hasMore: rows.length > limit },
  };
}

export async function downloadAdminSettlementExport(
  adminId: string,
  id: string,
) {
  const [job] = await db
    .select({
      ...publicJob,
      content: jobs.content,
      expired: sql<boolean>`coalesce(${jobs.expiresAt} <= clock_timestamp(), false)`,
    })
    .from(jobs)
    .where(and(eq(jobs.requestedBy, adminId), eq(jobs.id, id)));
  if (!job) throw new NotFoundException("EXPORT_NOT_FOUND");
  if (job.expired) throw new GoneException("EXPORT_EXPIRED");
  if (job.status !== "COMPLETED" || !job.content)
    throw new ConflictException("EXPORT_NOT_READY");
  return {
    format: job.query.format,
    bytes: Buffer.from(job.content, "base64"),
  };
}

export async function processAdminSettlementExport() {
  const claim = randomUUID();
  const job = await db.transaction(async (tx) => {
    // Khôi phục lease đã hết và ngăn tác vụ lỗi vô hạn khi worker dừng giữa chừng.
    await tx
      .update(jobs)
      .set({
        status: "FAILED",
        errorCode: "ATTEMPTS_EXHAUSTED",
        claim: null,
        expiresAt: sql`clock_timestamp() + interval '24 hours'`,
      })
      .where(
        sql`${jobs.status} = 'PROCESSING' AND ${jobs.availableAt} <= clock_timestamp() AND ${jobs.attempts} >= 3`,
      );
    const [next] = await tx
      .select({ id: jobs.id, query: jobs.query, attempts: jobs.attempts })
      .from(jobs)
      .where(
        sql`${jobs.status} IN ('PENDING', 'PROCESSING') AND ${jobs.availableAt} <= clock_timestamp() AND ${jobs.attempts} < 3`,
      )
      .orderBy(jobs.availableAt, jobs.id)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!next) return null;
    await tx
      .update(jobs)
      .set({
        status: "PROCESSING",
        claim,
        attempts: next.attempts + 1,
        availableAt: sql`clock_timestamp() + interval '5 minutes'`,
      })
      .where(eq(jobs.id, next.id));
    return next;
  });
  if (!job) return false;
  const ownsClaim = and(
    eq(jobs.id, job.id),
    eq(jobs.status, "PROCESSING"),
    eq(jobs.claim, claim),
  );
  try {
    const rows = await readAdminSettlementReport(job.query, true);
    const bytes = await renderAdminSettlementDownload(rows, job.query.format);
    if (bytes.length > 12 * 1024 * 1024)
      throw new UnprocessableEntityException("REPORT_FILE_TOO_LARGE");
    await db
      .update(jobs)
      .set({
        status: "COMPLETED",
        claim: null,
        errorCode: null,
        content: bytes.toString("base64"),
        expiresAt: sql`clock_timestamp() + interval '24 hours'`,
      })
      .where(ownsClaim);
  } catch (error) {
    const permanent = error instanceof UnprocessableEntityException;
    const failed = permanent || job.attempts + 1 >= 3;
    await db
      .update(jobs)
      .set({
        status: failed ? "FAILED" : "PENDING",
        claim: null,
        errorCode: permanent ? error.message : "REPORT_EXPORT_FAILED",
        availableAt: sql`clock_timestamp() + ${10 * 2 ** job.attempts} * interval '1 second'`,
        expiresAt: failed ? sql`clock_timestamp() + interval '24 hours'` : null,
      })
      .where(ownsClaim);
  }
  return true;
}

export async function cleanupAdminSettlementExports() {
  await db.delete(jobs).where(sql`${jobs.expiresAt} <= clock_timestamp()`);
}
