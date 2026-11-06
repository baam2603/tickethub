import { Injectable } from "@nestjs/common";
import { and, eq, inArray, desc } from "drizzle-orm";
import { db } from "../database/db";
import { orders } from "../database/schema/orders";
import { transactions } from "../database/schema/transactions";
import { refunds } from "../database/schema/refunds";
import { events } from "../database/schema/events";
import {
  ReconciliationStatus,
  type ReconciliationQueryDto,
} from "@tickethub/shared";

export interface ReconciliationItem {
  orderId: string | null;
  orderCode: string | null;
  eventId: string | null;
  eventTitle: string | null;
  orderAmount: number;
  paidAmount: number;
  refundedAmount: number;
  transactionRef: string | null;
  providerTxNumber: string | null;
  bankCode: string | null;
  payDate: Date | null;
  reconciliationStatus: ReconciliationStatus;
}

@Injectable()
export class ReconciliationsService {
  async getReconciliations(query: ReconciliationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // 1. Lay danh sach don hang can doi soat
    const orderConditions = [];
    if (query.eventId) {
      orderConditions.push(eq(orders.eventId, query.eventId));
    }

    const allOrders = await db
      .select({
        id: orders.id,
        orderCode: orders.orderCode,
        eventId: orders.eventId,
        eventTitle: events.title,
        status: orders.status,
        finalAmount: orders.finalAmount,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .innerJoin(events, eq(orders.eventId, events.id))
      .where(orderConditions.length > 0 ? and(...orderConditions) : undefined)
      .orderBy(desc(orders.createdAt));

    // 2. Lay tat ca cac giao dich VNPay
    const allTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.provider, "VNPAY"))
      .orderBy(desc(transactions.createdAt));

    // 3. Lay tat ca cac hoan ve thanh cong hoac dang cho
    const allRefunds = await db
      .select({
        orderId: refunds.orderId,
        amount: refunds.amount,
        status: refunds.status,
      })
      .from(refunds)
      .where(inArray(refunds.status, ["PENDING", "COMPLETED"]));

    // Map refunds theo orderId
    const refundMap = new Map<string, number>();
    for (const r of allRefunds) {
      const current = refundMap.get(r.orderId) ?? 0;
      refundMap.set(r.orderId, current + Number(r.amount || 0));
    }

    // Map transactions theo orderId
    const txByOrderId = new Map<string, typeof allTransactions[0]>();
    const matchedTxIds = new Set<string>();

    for (const tx of allTransactions) {
      if (tx.orderId) {
        // Uu tien transaction SUCCESS
        if (!txByOrderId.has(tx.orderId) || tx.status === "SUCCESS") {
          txByOrderId.set(tx.orderId, tx);
        }
      }
    }

    const items: ReconciliationItem[] = [];

    // Xet tung order
    for (const order of allOrders) {
      // Chi xet nhung don da PAID, REFUNDED hoac co transaction ghi nhan
      const tx = txByOrderId.get(order.id);
      if (tx) {
        matchedTxIds.add(tx.id);
      }

      if (order.status !== "PAID" && order.status !== "REFUNDED" && !tx) {
        continue;
      }

      const orderAmount = Number(order.finalAmount || 0);
      const paidAmount = tx && tx.status === "SUCCESS" ? Number(tx.amount || 0) : 0;
      const refundedAmount = refundMap.get(order.id) ?? 0;

      let status: ReconciliationStatus;
      if (!tx || tx.status !== "SUCCESS") {
        status = ReconciliationStatus.MISSING_TRANSACTION;
      } else if (orderAmount === paidAmount) {
        status = ReconciliationStatus.MATCHED;
      } else {
        status = ReconciliationStatus.AMOUNT_MISMATCH;
      }

      items.push({
        orderId: order.id,
        orderCode: order.orderCode,
        eventId: order.eventId,
        eventTitle: order.eventTitle,
        orderAmount,
        paidAmount,
        refundedAmount,
        transactionRef: tx?.transactionRef ?? null,
        providerTxNumber: tx?.providerTxNumber ?? null,
        bankCode: tx?.bankCode ?? null,
        payDate: tx?.payDate ?? null,
        reconciliationStatus: status,
      });
    }

    // Xet cac giao dich mo coi (Orphan transactions - khong tim thay order hop le)
    for (const tx of allTransactions) {
      if (!matchedTxIds.has(tx.id) && tx.status === "SUCCESS") {
        items.push({
          orderId: tx.orderId ?? null,
          orderCode: null,
          eventId: null,
          eventTitle: null,
          orderAmount: 0,
          paidAmount: Number(tx.amount || 0),
          refundedAmount: 0,
          transactionRef: tx.transactionRef,
          providerTxNumber: tx.providerTxNumber ?? null,
          bankCode: tx.bankCode ?? null,
          payDate: tx.payDate ?? null,
          reconciliationStatus: ReconciliationStatus.ORPHAN_TRANSACTION,
        });
      }
    }

    // Loc theo query status neu co
    const filteredItems =
      query.status && query.status !== "ALL"
        ? items.filter((item) => item.reconciliationStatus === query.status)
        : items;

    // Tinh toan summary tren toan bo danh sach items
    const summary = {
      totalTransactions: items.length,
      totalOrderAmount: items.reduce((sum, i) => sum + i.orderAmount, 0),
      totalPaidAmount: items.reduce((sum, i) => sum + i.paidAmount, 0),
      totalRefundedAmount: items.reduce((sum, i) => sum + i.refundedAmount, 0),
      matchedCount: items.filter(
        (i) => i.reconciliationStatus === ReconciliationStatus.MATCHED,
      ).length,
      mismatchedCount: items.filter(
        (i) => i.reconciliationStatus !== ReconciliationStatus.MATCHED,
      ).length,
    };

    // Phan trang
    const total = filteredItems.length;
    const offset = (page - 1) * limit;
    const paginatedItems = filteredItems.slice(offset, offset + limit);

    return {
      summary,
      items: paginatedItems,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
