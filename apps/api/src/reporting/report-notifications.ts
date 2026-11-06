import { and, asc, eq, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../database/db";
import { outbox, reportExports, users } from "../database/schema";
import { requireEvent } from "../organizer-operations/access";
import { env } from "../config/env.config";

export const REPORT_READY = "REPORT_EXPORT_COMPLETED";
const PayloadSchema = z.object({ exportId: z.string().uuid() }).strict();

// Thong bao doc lap voi tao file: provider loi khong doi job COMPLETED thanh FAILED.
// Worker khong gui email neu chua bat ro cau hinh production.
export async function processReportNotification() {
  if (
    process.env.ENABLE_REPORT_EMAIL_DELIVERY !== "true" ||
    process.env.ENABLE_REAL_EMAIL !== "true" ||
    process.env.EMAIL_WORKER_MODE !== "live"
  )
    return false;
  const web = new URL(process.env.REPORT_WEB_URL ?? "");
  if (
    web.username ||
    web.password ||
    (env.NODE_ENV === "production" && web.protocol !== "https:") ||
    !["http:", "https:"].includes(web.protocol)
  )
    throw new Error("INVALID_REPORT_WEB_URL");
  if (
    !env.RESEND_API_KEY ||
    !env.EMAIL_FROM ||
    (env.NODE_ENV === "production" && env.EMAIL_FROM.includes("resend.dev"))
  )
    throw new Error("REPORT_EMAIL_NOT_CONFIGURED");
  const event = await db.transaction(async (tx) => {
    const [found] = await tx
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.eventType, REPORT_READY),
          lte(outbox.nextRetryAt, new Date()),
          or(
            eq(outbox.status, "PENDING"),
            and(
              eq(outbox.status, "PROCESSING"),
              lte(outbox.updatedAt, new Date(Date.now() - 300000)),
            ),
          ),
        ),
      )
      .orderBy(asc(outbox.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!found) return null;
    const [claimed] = await tx
      .update(outbox)
      .set({ status: "PROCESSING", updatedAt: new Date() })
      .where(eq(outbox.id, found.id))
      .returning();
    return claimed!;
  });
  if (!event) return false;
  try {
    const payload = PayloadSchema.parse(event.payload);
    const job = await db.query.reportExports.findFirst({
      where: eq(reportExports.id, payload.exportId),
    });
    if (
      !job ||
      job.status !== "COMPLETED" ||
      !job.expiresAt ||
      job.expiresAt.getTime() <= Date.now()
    )
      throw new Error("REPORT_NO_LONGER_AVAILABLE");
    await requireEvent(job.requestedBy, job.eventId);
    const recipient = await db.query.users.findFirst({
      where: eq(users.id, job.requestedBy),
    });
    if (!recipient) throw new Error("REPORT_RECIPIENT_NOT_FOUND");
    // Link den trang da dang nhap. Khong dua JWT, duong dan file hay link public vao email.
    const link = new URL(`/organizer/events/${job.eventId}/stats`, web.origin);
    link.searchParams.set("exportId", job.id);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `report/${event.id}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: recipient.email,
        subject: "Báo cáo TicketHub đã sẵn sàng",
        text: `Báo cáo ${job.format.toUpperCase()} đã được tạo. Đăng nhập tài khoản BTC để tải tại: ${link.toString()}\nTệp hết hạn: ${job.expiresAt.toISOString()}.`,
      }),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("REPORT_EMAIL_PROVIDER_FAILED");
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== "object" ||
      !("id" in result) ||
      typeof result.id !== "string"
    )
      throw new Error("REPORT_EMAIL_PROVIDER_FAILED");
    await db
      .update(outbox)
      .set({ status: "COMPLETED", errorMessage: null, updatedAt: new Date() })
      .where(
        and(
          eq(outbox.id, event.id),
          eq(outbox.status, "PROCESSING"),
          eq(outbox.updatedAt, event.updatedAt),
        ),
      );
  } catch {
    const retry = event.retryCount + 1;
    await db
      .update(outbox)
      .set({
        status: retry >= 3 ? "FAILED" : "PENDING",
        retryCount: retry,
        errorMessage: "REPORT_NOTIFICATION_FAILED",
        nextRetryAt: new Date(Date.now() + 2000 * 2 ** retry),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outbox.id, event.id),
          eq(outbox.status, "PROCESSING"),
          eq(outbox.updatedAt, event.updatedAt),
        ),
      );
  }
  return true;
}
