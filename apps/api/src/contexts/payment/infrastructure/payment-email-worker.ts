import { and, eq, inArray, sql } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";
import { env } from "../../../config/env.config";
import { db } from "../../../database/db";
import {
  events,
  orders,
  outbox,
  refunds,
  tickets,
  users,
} from "../../../database/schema";

export async function processPaymentEmails() {
  if (
    process.env.ENABLE_PAYMENT_EMAIL !== "true" ||
    !env.RESEND_API_KEY?.trim()
  )
    throw new Error("Payment email is disabled or Resend is not configured");
  if (env.NODE_ENV === "production" && env.EMAIL_FROM.includes("resend.dev"))
    throw new Error("Verified email sender required");
  const resend = new Resend(env.RESEND_API_KEY);
  await db
    .update(outbox)
    .set({ status: "FAILED", errorMessage: "PAYMENT_EMAIL_DELIVERY_FAILED" })
    .where(sql`${outbox.eventType} in ('ORDER_PAID', 'REFUND_COMPLETED')
      AND ${outbox.status} = 'PROCESSING' AND ${outbox.retryCount} >= 8
      AND ${outbox.updatedAt} < clock_timestamp() - interval '5 minutes'`);
  for (let i = 0; i < 10; i++) {
    const event = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(outbox)
        .where(
          sql`
        ${outbox.eventType} in ('ORDER_PAID', 'REFUND_COMPLETED')
        AND ${outbox.retryCount} < 8
        AND ${outbox.nextRetryAt} <= clock_timestamp()
        AND (${outbox.status} = 'PENDING' OR
            (${outbox.status} = 'PROCESSING' AND ${outbox.updatedAt} < clock_timestamp() - interval '5 minutes'))
      `,
        )
        .orderBy(outbox.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      const [saved] = await tx
        .update(outbox)
        .set({
          status: "PROCESSING",
          retryCount: row.retryCount + 1,
          updatedAt: sql`date_trunc('milliseconds', clock_timestamp())`,
        })
        .where(eq(outbox.id, row.id))
        .returning();
      return saved!;
    });
    if (!event) return;
    const owns = and(
      eq(outbox.id, event.id),
      eq(outbox.status, "PROCESSING"),
      eq(outbox.updatedAt, event.updatedAt),
    );
    try {
      const { orderId } = z.object({ orderId: z.uuid() }).parse(event.payload);
      const [order] = await db
        .select({
          orderCode: orders.orderCode,
          email: users.email,
          title: events.title,
        })
        .from(orders)
        .innerJoin(users, eq(users.id, orders.userId))
        .innerJoin(events, eq(events.id, orders.eventId))
        .where(eq(orders.id, orderId));
      if (!order) throw new Error("Order not found");
      const paid = event.eventType === "ORDER_PAID";
      let detail: string;
      if (paid) {
        const issued = await db
          .select({ code: tickets.ticketCode })
          .from(tickets)
          .where(eq(tickets.orderId, orderId));
        detail = issued.map(({ code }) => "Mã vé " + code).join("\n");
      } else {
        const { refundIds } = z
          .object({ refundIds: z.array(z.uuid()).min(1) })
          .parse(event.payload);
        const completed = await db
          .select({ amount: refunds.amount })
          .from(refunds)
          .where(
            and(
              eq(refunds.orderId, orderId),
              eq(refunds.status, "COMPLETED"),
              inArray(refunds.id, refundIds),
            ),
          );
        if (completed.length !== refundIds.length)
          throw new Error("Refund is not confirmed");
        detail =
          "VNPay đã hoàn " +
          completed
            .reduce((sum, r) => sum + Number(r.amount), 0)
            .toLocaleString("vi-VN") +
          " VND.";
      }
      const { data, error } = await resend.emails.send(
        {
          from: env.EMAIL_FROM,
          to: order.email,
          subject: paid
            ? "[TicketHub] Xác nhận thanh toán"
            : "[TicketHub] Xác nhận hoàn tiền",
          text: [
            order.title,
            "Đơn hàng " + order.orderCode,
            detail,
            "Vui lòng đăng nhập TicketHub để xem chi tiết.",
          ].join("\n"),
        },
        { idempotencyKey: "payment/" + event.id },
      );
      if (error || !data?.id) throw new Error("Resend did not accept email");
      await db
        .update(outbox)
        .set({ status: "COMPLETED", errorMessage: null })
        .where(owns);
    } catch {
      await db
        .update(outbox)
        .set({
          status: event.retryCount >= 8 ? "FAILED" : "PENDING",
          errorMessage: "PAYMENT_EMAIL_DELIVERY_FAILED",
          nextRetryAt: sql`clock_timestamp() + ${30 * 2 ** event.retryCount} * interval '1 second'`,
        })
        .where(owns);
    }
  }
}
