import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  OutboxStatus,
  PaymentProvider,
  RefundStatus,
  SeatStatus,
  TicketStatus,
  TransactionStatus,
  OrderStatus,
} from "@tickethub/shared";
import { db } from "../../../database/db";
import {
  auditLog,
  events,
  orderItems,
  orders,
  outbox,
  refunds,
  seats,
  ticketTypes,
  tickets,
  transactions,
  users,
} from "../../../database/schema";
import {
  canRestoreSeat,
  canRestoreStanding,
  planLateRefund,
} from "../domain/late-payment-rules";
import { PaymentDomainError, paymentErrors } from "../domain/payment.errors";
import { buildCallbackEvidence, generateTicketCode } from "../domain/ipn-rules";
import type {
  PaymentOrder,
  PaymentTransaction,
  PendingVnpayTransaction,
  SettlementImpact,
  SettlementItem,
  VnpayParams,
} from "../domain/payment.models";
import type {
  CheckoutTransaction,
  CheckoutUnitOfWork,
  IpnTransaction,
  IpnUnitOfWork,
  PaymentQueryPort,
} from "../domain/payment.ports";

type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function toOrder(row: typeof orders.$inferSelect): PaymentOrder {
  return {
    id: row.id,
    orderCode: row.orderCode,
    userId: row.userId,
    eventId: row.eventId,
    status: row.status,
    finalAmount: row.finalAmount,
    expiresAt: row.expiresAt,
  };
}

function toTransaction(
  row: typeof transactions.$inferSelect,
): PaymentTransaction {
  return {
    id: row.id,
    orderId: row.orderId,
    transactionRef: row.transactionRef,
    status: row.status,
    amount: row.amount,
    provider: row.provider,
  };
}

class DrizzleCheckoutTransaction implements CheckoutTransaction {
  constructor(private readonly tx: DbTx) {}

  async lockOwnedOrder(userId: string, orderId: string) {
    const [order] = await this.tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .limit(1)
      .for("update");
    if (!order) return null;
    const [snapshot] = await this.tx
      .select({
        valid: sql<boolean>`coalesce(bool_and(
        ${orderItems.quantity} > 0 AND ${orderItems.unitPrice} >= 0 AND
        ${orderItems.unitPrice} * ${orderItems.quantity} = ${orderItems.subtotal}
      ), false) AND coalesce(sum(${orderItems.subtotal}), 0) = ${order.totalAmount}::numeric
        AND ${order.totalAmount}::numeric - ${order.discountAmount}::numeric = ${order.finalAmount}::numeric
        AND ${order.discountAmount}::numeric >= 0`,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    if (
      !snapshot?.valid ||
      (Number(order.discountAmount) > 0 && !order.voucherCode?.trim())
    )
      throw paymentErrors.amountMismatch();
    return toOrder(order);
  }

  async claimIdempotencyKey(key: string, orderId: string) {
    await this.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
    );
    const [claimed] = await this.tx
      .select({ orderId: transactions.orderId })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, key))
      .limit(1);
    if (claimed && claimed.orderId !== orderId)
      throw new PaymentDomainError(
        "CONFLICT",
        "Idempotency key belongs to another order",
      );
  }

  async lockVnpayTransaction(
    orderId: string,
  ): Promise<PendingVnpayTransaction | null> {
    const [row] = await this.tx
      .select({
        id: transactions.id,
        transactionRef: transactions.transactionRef,
        status: transactions.status,
        amount: transactions.amount,
        paymentUrl: sql<
          string | null
        >`${transactions.rawCallback}->>'checkoutUrl'`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.orderId, orderId),
          eq(transactions.provider, PaymentProvider.VNPAY),
        ),
      )
      .limit(1)
      .for("update");
    return row ?? null;
  }

  async insertPendingTransaction(input: {
    orderId: string;
    transactionRef: string;
    amount: string;
    idempotencyKey: string;
    createDate: string;
    paymentUrl: string;
  }) {
    await this.tx.insert(transactions).values({
      rawCallback: {
        vnp_CreateDate: input.createDate,
        checkoutUrl: input.paymentUrl,
      },
      orderId: input.orderId,
      provider: PaymentProvider.VNPAY,
      transactionRef: input.transactionRef,
      amount: input.amount,
      status: TransactionStatus.PENDING,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

export class DrizzleCheckoutUnitOfWork implements CheckoutUnitOfWork {
  run<T>(work: (tx: CheckoutTransaction) => Promise<T>): Promise<T> {
    return db.transaction((tx) => work(new DrizzleCheckoutTransaction(tx)));
  }
}

class DrizzleIpnTransaction implements IpnTransaction {
  constructor(private readonly tx: DbTx) {}

  async lockOrder(orderId: string) {
    const [order] = await this.tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");
    return order ? toOrder(order) : null;
  }

  async lockTransaction(transactionId: string) {
    const [row] = await this.tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .for("update");
    return row ? toTransaction(row) : null;
  }

  async hasManualReviewAudit(transactionId: string) {
    const [row] = await this.tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "VNPAY_IPN_MANUAL_REVIEW"),
          eq(auditLog.targetType, "TRANSACTION"),
          eq(auditLog.targetId, transactionId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async recordManualReview(input: {
    transaction: PaymentTransaction;
    order: PaymentOrder;
    params: VnpayParams;
    providerTxNumber: string | null;
  }) {
    const { transaction, order, params } = input;
    const evidence = buildCallbackEvidence(params);

    await this.tx
      .update(transactions)
      .set({
        rawCallback: sql`(coalesce(${transactions.rawCallback}, '{}'::jsonb) - 'checkoutUrl') || ${JSON.stringify(evidence)}::jsonb`,
        responseCode: params.vnp_ResponseCode ?? null,
        providerTxNumber: input.providerTxNumber,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transaction.id));

    await this.tx.insert(auditLog).values({
      actorRole: "SYSTEM",
      action: "VNPAY_IPN_MANUAL_REVIEW",
      targetType: "TRANSACTION",
      targetId: transaction.id,
      changes: {
        orderId: order.id,
        orderCode: order.orderCode,
        orderStatus: order.status,
        transactionStatus: transaction.status,
        reason: "SUCCESS_CALLBACK_REQUIRES_REVIEW",
        callback: evidence,
        recordedAt: new Date().toISOString(),
      },
    });
  }

  async findOrderItems(orderId: string): Promise<SettlementItem[]> {
    const rows = await this.tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    return rows.map((r) => ({
      seatId: r.seatId,
      ticketTypeId: r.ticketTypeId,
      quantity: r.quantity,
    }));
  }

  async settleSeat(
    order: PaymentOrder,
    item: SettlementItem,
    sold: boolean,
    now: Date,
  ) {
    const updated = await this.tx
      .update(seats)
      .set({
        status: sold ? SeatStatus.SOLD : SeatStatus.AVAILABLE,
        holdOrderId: null,
        holdExpiresAt: null,
        version: sql`${seats.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(seats.id, item.seatId!),
          eq(seats.eventId, order.eventId),
          eq(seats.ticketTypeId, item.ticketTypeId),
          eq(seats.status, SeatStatus.HELD),
          eq(seats.holdOrderId, order.id),
          ...(sold ? [gte(seats.holdExpiresAt, now)] : []),
        ),
      )
      .returning({ id: seats.id });
    return updated.length === 1;
  }

  async settleStanding(
    order: PaymentOrder,
    item: SettlementItem,
    sold: boolean,
    now: Date,
  ) {
    const updated = await this.tx
      .update(ticketTypes)
      .set({
        heldCount: sql`${ticketTypes.heldCount} - ${item.quantity}`,
        ...(sold
          ? { soldCount: sql`${ticketTypes.soldCount} + ${item.quantity}` }
          : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(ticketTypes.id, item.ticketTypeId),
          eq(ticketTypes.eventId, order.eventId),
          eq(ticketTypes.isSeated, false),
          gte(ticketTypes.heldCount, item.quantity),
        ),
      )
      .returning({ id: ticketTypes.id });
    return updated.length === 1;
  }

  async findEventStatus(eventId: string): Promise<string | null> {
    const [row] = await this.tx
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    return row?.status ?? null;
  }

  async tryRestoreOrder(
    order: PaymentOrder,
    items: SettlementItem[],
    now: Date,
  ): Promise<boolean> {
    // 1. Khoa va kiem tra ghe theo id tang dan (cung thu tu khoa voi Booking)
    const seatItems = items.filter((i) => i.seatId !== null);
    const seatIds = seatItems.map((i) => i.seatId!).sort();
    if (seatIds.length > 0) {
      const rows = await this.tx
        .select({
          id: seats.id,
          status: seats.status,
          holdOrderId: seats.holdOrderId,
          ticketTypeId: seats.ticketTypeId,
        })
        .from(seats)
        .where(
          and(inArray(seats.id, seatIds), eq(seats.eventId, order.eventId)),
        )
        .orderBy(asc(seats.id))
        .for("update");
      if (rows.length !== seatIds.length) return false;
      const typeBySeat = new Map(
        seatItems.map((i) => [i.seatId!, i.ticketTypeId]),
      );
      for (const row of rows) {
        if (
          row.ticketTypeId !== typeBySeat.get(row.id) ||
          !canRestoreSeat(row, order.id)
        ) {
          return false;
        }
      }
    }

    // 2. Khoa va kiem tra hang ve dung
    const standing = new Map<string, number>();
    for (const item of items) {
      if (item.seatId === null) {
        standing.set(
          item.ticketTypeId,
          (standing.get(item.ticketTypeId) ?? 0) + item.quantity,
        );
      }
    }
    const standingIds = [...standing.keys()].sort();
    if (standingIds.length > 0) {
      const rows = await this.tx
        .select({
          id: ticketTypes.id,
          isSeated: ticketTypes.isSeated,
          capacity: ticketTypes.capacity,
          heldCount: ticketTypes.heldCount,
          soldCount: ticketTypes.soldCount,
        })
        .from(ticketTypes)
        .where(
          and(
            inArray(ticketTypes.id, standingIds),
            eq(ticketTypes.eventId, order.eventId),
          ),
        )
        .orderBy(asc(ticketTypes.id))
        .for("update");
      if (rows.length !== standingIds.length) return false;
      for (const row of rows) {
        if (!canRestoreStanding(row, standing.get(row.id)!, order.status)) {
          return false;
        }
      }
    }

    // 3. Tat ca dieu kien dat: ap dung thay doi
    if (seatIds.length > 0) {
      await this.tx
        .update(seats)
        .set({
          status: SeatStatus.SOLD,
          holdOrderId: null,
          holdExpiresAt: null,
          version: sql`${seats.version} + 1`,
          updatedAt: now,
        })
        .where(inArray(seats.id, seatIds));
    }
    for (const [ticketTypeId, qty] of standing) {
      await this.tx
        .update(ticketTypes)
        .set({
          ...(order.status === OrderStatus.PENDING
            ? { heldCount: sql`${ticketTypes.heldCount} - ${qty}` }
            : {}),
          soldCount: sql`${ticketTypes.soldCount} + ${qty}`,
          updatedAt: now,
        })
        .where(eq(ticketTypes.id, ticketTypeId));
    }
    return true;
  }

  async requestLateRefund(input: {
    order: PaymentOrder;
    transaction: PaymentTransaction;
    now: Date;
  }): Promise<void> {
    const { order, transaction, now } = input;
    const plan = planLateRefund(order, transaction);

    await this.tx
      .update(orders)
      .set({
        status: OrderStatus.PAYMENT_EXPIRED_REFUND_PENDING,
        updatedAt: now,
      })
      .where(eq(orders.id, order.id));

    const [refund] = await this.tx
      .insert(refunds)
      .values({
        orderId: order.id,
        ticketId: null,
        amount: String(plan.amount),
        reason: plan.reason,
        status: RefundStatus.PENDING,
        idempotencyKey: plan.idempotencyKey,
      })
      .returning({ id: refunds.id });

    await this.tx.insert(outbox).values({
      eventType: "REFUND_REQUESTED",
      status: OutboxStatus.PENDING,
      payload: {
        orderId: order.id,
        orderCode: order.orderCode,
        refundIds: [refund!.id],
        ticketIds: [],
        userId: order.userId,
        eventId: order.eventId,
        amount: plan.amount,
        reason: plan.reason,
        isPartial: false,
        source: "LATE_IPN",
        requestedAt: now.toISOString(),
      },
    });

    const [buyer] = await this.tx
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, order.userId))
      .limit(1);
    if (buyer) {
      await this.tx.insert(outbox).values({
        eventType: "PAYMENT_EXPIRED_REFUND_NOTICE",
        status: OutboxStatus.PENDING,
        payload: {
          orderId: order.id,
          orderCode: order.orderCode,
          userId: order.userId,
          email: buyer.email,
          fullName: buyer.fullName,
          amount: plan.amount,
        },
      });
    }

    await this.tx.insert(auditLog).values({
      actorRole: "SYSTEM",
      action: "VNPAY_IPN_LATE_REFUND_PENDING",
      targetType: "TRANSACTION",
      targetId: transaction.id,
      changes: {
        orderId: order.id,
        orderCode: order.orderCode,
        previousOrderStatus: order.status,
        refundId: refund!.id,
        refundAmount: plan.amount,
        recordedAt: now.toISOString(),
      },
    });
  }

  async recordLateRestored(input: {
    order: PaymentOrder;
    transaction: PaymentTransaction;
    now: Date;
  }): Promise<void> {
    const { order, transaction, now } = input;
    await this.tx.insert(auditLog).values({
      actorRole: "SYSTEM",
      action: "VNPAY_IPN_LATE_RESTORED",
      targetType: "TRANSACTION",
      targetId: transaction.id,
      changes: {
        orderId: order.id,
        orderCode: order.orderCode,
        previousOrderStatus: order.status,
        recordedAt: now.toISOString(),
      },
    });
  }

  async completeTransaction(input: {
    transactionId: string;
    success: boolean;
    params: VnpayParams;
    providerTxNumber: string | null;
    now: Date;
  }) {
    await this.tx
      .update(transactions)
      .set({
        status: input.success
          ? TransactionStatus.SUCCESS
          : TransactionStatus.FAILED,
        responseCode: input.params.vnp_ResponseCode ?? null,
        providerTxNumber: input.providerTxNumber,
        bankCode: input.params.vnp_BankCode ?? null,
        // Gop vao du lieu da luu (vnp_CreateDate) thay vi ghi de
        rawCallback: sql`(coalesce(${transactions.rawCallback}, '{}'::jsonb) - 'checkoutUrl') || ${JSON.stringify(buildCallbackEvidence(input.params))}::jsonb`,
        updatedAt: input.now,
      })
      .where(eq(transactions.id, input.transactionId));
  }

  async completeOrder(orderId: string, paid: boolean, now: Date) {
    await this.tx
      .update(orders)
      .set({
        status: paid ? OrderStatus.PAID : OrderStatus.FAILED,
        paidAt: paid ? now : null,
        updatedAt: now,
      })
      .where(eq(orders.id, orderId));
  }

  async issueTicketsWithOutbox(input: {
    order: PaymentOrder;
    transaction: PaymentTransaction;
    items: SettlementItem[];
    now: Date;
  }) {
    const { order, transaction, items, now } = input;
    const ticketRows = items.flatMap((item) =>
      Array.from({ length: item.quantity }, () => ({
        ticketCode: generateTicketCode(),
        orderId: order.id,
        userId: order.userId,
        eventId: order.eventId,
        ticketTypeId: item.ticketTypeId,
        seatId: item.seatId,
        status: TicketStatus.SOLD,
      })),
    );

    const issued = await this.tx
      .insert(tickets)
      .values(ticketRows)
      .returning({ id: tickets.id });

    await this.tx.insert(outbox).values({
      eventType: "ORDER_PAID",
      status: OutboxStatus.PENDING,
      payload: {
        orderId: order.id,
        orderCode: order.orderCode,
        userId: order.userId,
        eventId: order.eventId,
        transactionId: transaction.id,
        transactionRef: transaction.transactionRef,
        provider: PaymentProvider.VNPAY,
        amount: order.finalAmount,
        ticketIds: issued.map((t) => t.id),
        paidAt: now.toISOString(),
      },
    });
  }
}

export class DrizzleIpnUnitOfWork implements IpnUnitOfWork {
  run<T>(work: (tx: IpnTransaction) => Promise<T>): Promise<T> {
    return db.transaction((tx) => work(new DrizzleIpnTransaction(tx)));
  }
}

export class DrizzlePaymentQuery implements PaymentQueryPort {
  async findVnpayTransactionByRef(transactionRef: string) {
    const row = await db.query.transactions.findFirst({
      where: and(
        eq(transactions.transactionRef, transactionRef),
        eq(transactions.provider, PaymentProvider.VNPAY),
      ),
    });
    return row ? toTransaction(row) : null;
  }

  async findTransactionByRef(transactionRef: string) {
    const [row] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.transactionRef, transactionRef))
      .limit(1);
    return row ? toTransaction(row) : null;
  }

  async findOwnedPayment(
    userId: string,
    filter: { orderId: string } | { transactionRef: string },
  ) {
    const [found, duplicate] = await db
      .select({
        orderId: orders.id,
        orderCode: orders.orderCode,
        orderStatus: orders.status,
        transactionStatus: transactions.status,
        transactionRef: transactions.transactionRef,
        createDate: sql<
          string | null
        >`${transactions.rawCallback}->>'vnp_CreateDate'`,
      })
      .from(transactions)
      .innerJoin(orders, eq(orders.id, transactions.orderId))
      .where(
        and(
          eq(orders.userId, userId),
          eq(transactions.provider, PaymentProvider.VNPAY),
          "orderId" in filter
            ? eq(orders.id, filter.orderId)
            : eq(transactions.transactionRef, filter.transactionRef),
        ),
      )
      .limit(2);
    return duplicate ? null : (found ?? null);
  }

  async findOrder(orderId: string) {
    const [row] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return row ? toOrder(row) : null;
  }

  async findSettlementImpact(
    orderId: string,
  ): Promise<SettlementImpact | null> {
    const [order] = await db
      .select({ eventId: orders.eventId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!order) return null;

    const rows = await db
      .select({ seatId: orderItems.seatId })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));
    return {
      eventId: order.eventId,
      seatIds: rows
        .map((r) => r.seatId)
        .filter((id): id is string => id !== null && id !== undefined),
    };
  }
}
