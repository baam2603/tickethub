import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import type Redis from "ioredis";
import { db } from "../database/db";
import { gateCheckinLogs, reportExports, users } from "../database/schema";
import { requireEvent } from "../organizer-operations/access";
import type { Page } from "../organizer-operations/operations.schemas";
import { readReport } from "./report-data";
export const REPORT_REDIS = "REPORT_REDIS";
@Injectable()
export class ReportsService {
  constructor(@Inject(REPORT_REDIS) private readonly redis: Redis) {}
  onModuleDestroy() {
    this.redis.disconnect();
  }
  async report(userId: string, eventId: string) {
    const { profile } = await requireEvent(userId, eventId);
    const key = `uc09:v1:${profile.id}:${eventId}`;
    try {
      const cached = await this.redis.get(key);
      if (cached)
        return JSON.parse(cached) as Awaited<ReturnType<typeof readReport>>;
    } catch {
      /* MV van la nguon doc khi Redis loi. */
    }
    const result = await readReport(eventId, profile.id);
    try {
      await this.redis.set(key, JSON.stringify(result), "EX", 60);
    } catch {
      /* Khong chan bao cao neu cache loi. */
    }
    return result;
  }
  async history(userId: string, eventId: string, page: Page) {
    await requireEvent(userId, eventId);
    return db
      .select()
      .from(gateCheckinLogs)
      .where(eq(gateCheckinLogs.eventId, eventId))
      .orderBy(desc(gateCheckinLogs.checkedInAt), desc(gateCheckinLogs.id))
      .limit(page.limit)
      .offset((page.page - 1) * page.limit);
  }
  async createExport(userId: string, eventId: string, format: "csv" | "xlsx") {
    const { profile } = await requireEvent(userId, eventId);
    return db.transaction(async (tx) => {
      await tx.select().from(users).where(eq(users.id, userId)).for("update");
      const pending = await tx
        .select({ id: reportExports.id })
        .from(reportExports)
        .where(
          and(
            eq(reportExports.requestedBy, userId),
            inArray(reportExports.status, ["PENDING", "PROCESSING"]),
          ),
        );
      if (pending.length >= 3)
        throw new ConflictException("EXPORT_QUEUE_LIMIT");
      const [job] = await tx
        .insert(reportExports)
        .values({
          requestedBy: userId,
          organizerId: profile.id,
          eventId,
          format,
        })
        .returning({
          id: reportExports.id,
          status: reportExports.status,
          format: reportExports.format,
          createdAt: reportExports.createdAt,
        });
      return job!;
    });
  }
  async exportStatus(userId: string, eventId: string, exportId: string) {
    const { profile } = await requireEvent(userId, eventId);
    const job = await db.query.reportExports.findFirst({
      where: and(
        eq(reportExports.id, exportId),
        eq(reportExports.eventId, eventId),
        eq(reportExports.organizerId, profile.id),
        eq(reportExports.requestedBy, userId),
      ),
    });
    if (!job) throw new NotFoundException("EXPORT_NOT_FOUND");
    const expired = job.expiresAt && job.expiresAt.getTime() <= Date.now();
    return { ...job, status: expired ? "EXPIRED" : job.status };
  }
  async download(userId: string, eventId: string, exportId: string) {
    const job = await this.exportStatus(userId, eventId, exportId);
    if (job.status === "EXPIRED") throw new GoneException("EXPORT_EXPIRED");
    if (job.status !== "COMPLETED" || !job.fileName)
      throw new ConflictException("EXPORT_NOT_READY");
    return job;
  }
}
