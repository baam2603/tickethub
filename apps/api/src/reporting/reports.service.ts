import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type Redis from "ioredis";
import { db } from "../database/db";
import { gateCheckinLogs, reportExports, users } from "../database/schema";
import {
  requireEvent,
  requireReportEvent,
} from "../organizer-operations/access";
import type {
  Page,
  ReportPeriod,
} from "../organizer-operations/operations.schemas";
import { readReportBreakdown } from "./report-breakdown";
import { readCheckinSummary } from "./checkin-summary";
import { readReport } from "./report-data";
export const REPORT_REDIS = "REPORT_REDIS";
@Injectable()
export class ReportsService {
  constructor(@Inject(REPORT_REDIS) private readonly redis: Redis) {}
  onModuleDestroy() {
    this.redis.disconnect();
  }
  async report(userId: string, eventId: string, period: ReportPeriod = {}) {
    const { profile } = await requireReportEvent(
      userId,
      eventId,
      period.ticketTypeId,
    );
    const key = `uc09:v2:${profile.id}:${eventId}:${period.fromDate ?? "all"}:${period.toDate ?? "all"}:${period.ticketTypeId ?? "all"}:${period.voucherCode ?? "all"}`;
    try {
      const cached = await this.redis.get(key);
      if (cached)
        return JSON.parse(cached) as Awaited<ReturnType<typeof readReport>>;
    } catch {
      /* MV van la nguon doc khi Redis loi. */
    }
    const result = await readReport(eventId, profile.id, period);
    try {
      await this.redis.set(key, JSON.stringify(result), "EX", 60);
    } catch {
      /* Khong chan bao cao neu cache loi. */
    }
    return result;
  }
  async breakdown(
    userId: string,
    eventId: string,
    filter: Page & ReportPeriod,
    kind: "buyers" | "vouchers",
  ) {
    const { profile } = await requireReportEvent(
      userId,
      eventId,
      filter.ticketTypeId,
    );
    return readReportBreakdown(eventId, profile.id, filter, kind);
  }
  async checkinSummary(userId: string, eventId: string) {
    await requireEvent(userId, eventId);
    return readCheckinSummary(eventId);
  }
  async history(userId: string, eventId: string, page: Page) {
    await requireEvent(userId, eventId);
    return db
      .select()
      .from(gateCheckinLogs)
      .where(eq(gateCheckinLogs.eventId, eventId))
      .orderBy(desc(gateCheckinLogs.checkedInAt), desc(gateCheckinLogs.id))
      .limit(page.limit + 1)
      .offset((page.page - 1) * page.limit);
  }
  async createExport(
    userId: string,
    eventId: string,
    format: "csv" | "xlsx",
    period: ReportPeriod = {},
  ) {
    const { profile } = await requireReportEvent(
      userId,
      eventId,
      period.ticketTypeId,
    );
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
          ticketTypeId: period.ticketTypeId ?? null,
          voucherCode: period.voucherCode ?? null,
          fromDate: period.fromDate ?? null,
          toDate: period.toDate ?? null,
        })
        .returning({
          id: reportExports.id,
          status: reportExports.status,
          format: reportExports.format,
          createdAt: reportExports.createdAt,
          ticketTypeId: reportExports.ticketTypeId,
          voucherCode: reportExports.voucherCode,
          fromDate: reportExports.fromDate,
          toDate: reportExports.toDate,
        });
      return job!;
    });
  }
  async listExports(userId: string, eventId: string, page: Page) {
    const { profile } = await requireEvent(userId, eventId);
    const jobs = await db
      .select({
        id: reportExports.id,
        status: reportExports.status,
        format: reportExports.format,
        createdAt: reportExports.createdAt,
        expiresAt: reportExports.expiresAt,
        expired: sql<boolean>`${reportExports.expiresAt} <= clock_timestamp()`,
        errorMessage: reportExports.errorMessage,
        ticketTypeId: reportExports.ticketTypeId,
        voucherCode: reportExports.voucherCode,
        fromDate: reportExports.fromDate,
        toDate: reportExports.toDate,
      })
      .from(reportExports)
      .where(
        and(
          eq(reportExports.eventId, eventId),
          eq(reportExports.organizerId, profile.id),
          eq(reportExports.requestedBy, userId),
        ),
      )
      .orderBy(desc(reportExports.createdAt), desc(reportExports.id))
      .limit(page.limit + 1)
      .offset((page.page - 1) * page.limit);
    return jobs.map(({ expired, ...job }) => ({
      ...job,
      status: expired ? "EXPIRED" : job.status,
      downloadUrl:
        job.status === "COMPLETED" && job.expiresAt && !expired
          ? `/api/v1/organizer/events/${eventId}/reports/exports/${job.id}/download`
          : null,
    }));
  }
  async exportStatus(userId: string, eventId: string, exportId: string) {
    const { profile } = await requireEvent(userId, eventId);
    const job = await db.query.reportExports.findFirst({
      extras: {
        expired:
          sql<boolean>`${reportExports.expiresAt} <= clock_timestamp()`.as(
            "expired",
          ),
      },
      where: and(
        eq(reportExports.id, exportId),
        eq(reportExports.eventId, eventId),
        eq(reportExports.organizerId, profile.id),
        eq(reportExports.requestedBy, userId),
      ),
    });
    if (!job) throw new NotFoundException("EXPORT_NOT_FOUND");
    const expired = job.expired;
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
