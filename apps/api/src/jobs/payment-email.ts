import { eq } from "drizzle-orm";
import { EnvHttpProxyAgent, fetch } from "undici";
import { z } from "zod";
import { db } from "../database/db";
import { events, orders, tickets, users } from "../database/schema";
import { env } from "../config/env.config";

export async function paymentEmailContent(eventType: string, payload: unknown) {
  const { orderId } = z.object({ orderId: z.string().uuid() }).parse(payload);
  const [row] = await db
    .select({ order: orders, buyer: users, event: events })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.id, orderId));
  if (!row) throw new Error("Email order not found");
  const issued = await db
    .select()
    .from(tickets)
    .where(eq(tickets.orderId, orderId));
  return {
    to: row.buyer.email,
    subject:
      eventType === "ORDER_PAID"
        ? "[TicketHub] Xac nhan ve da thanh toan"
        : "[TicketHub] Xac nhan hoan tien",
    text: [
      `Xin chao ${row.buyer.fullName},`,
      `Don hang: ${row.order.orderCode}`,
      `Su kien: ${row.event.title}`,
      `Dia diem: ${row.event.venueName}`,
      `Thoi gian: ${row.event.startTime.toISOString()}`,
      ...(eventType === "ORDER_PAID"
        ? issued.map((t) => `Ma ve: ${t.ticketCode}`)
        : [
            "VNPay da hoan lai tien cho yeu cau nay. Vui long xem chi tiet ly do va so tien trong don hang.",
          ]),
      "Dang nhap TicketHub de xem chi tiet don hang va ve.",
    ].join("\n"),
  };
}

export async function sendPaymentEmail(
  id: string,
  eventType: string,
  payload: unknown,
) {
  if (process.env.ENABLE_PAYMENT_EMAIL !== "true" || !env.RESEND_API_KEY)
    throw new Error("Payment email is not configured or enabled");
  if (env.NODE_ENV === "production" && env.EMAIL_FROM.includes("resend.dev"))
    throw new Error("Verified email sender required");
  const url = new URL(
    process.env.RESEND_API_URL ?? "https://api.resend.com/emails",
  );
  if (
    url.protocol !== "https:" &&
    !(env.NODE_ENV === "test" && url.hostname === "127.0.0.1")
  )
    throw new Error("Email API requires HTTPS");
  const content = await paymentEmailContent(eventType, payload);
  const dispatcher = new EnvHttpProxyAgent();
  try {
    const response = await fetch(url, {
      method: "POST",
      dispatcher,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": `payment/${id}`,
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, ...content }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Email provider HTTP ${response.status}`);
    }
    z.object({ id: z.string().min(1) }).parse(await response.json());
  } finally {
    await dispatcher.close();
  }
}
