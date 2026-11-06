import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";

import {
  OrderStatus,
  TransactionStatus,
  PaymentProvider,
} from "@tickethub/shared";

import { db } from "../database/db";
import { orders, transactions, orderItems } from "../database/schema";
import { VnpayGateway } from "./vnpay.gateway";
import { env } from "../config/env.config";
import { parseVndAmount } from "./vnpay-amount";

@Injectable()
export class PaymentService {
  async createVnpayPayment(
    userId: string,
    orderId: string,
    clientIp: string,
    idempotencyKey?: string,
  ) {
    return db
      .transaction(async (tx) => {
        // 1. Khóa đơn hàng để tránh hai request
        // đồng thời tạo hai giao dịch.
        const [order] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
          .limit(1)
          .for("update");

        if (!order) {
          throw new NotFoundException("Order not found");
        }

        if (order.status !== OrderStatus.PENDING) {
          throw new ConflictException("Order is not pending");
        }

        const now = new Date();

        // Yêu cầu còn tối thiểu 45 giây giữ vé.
        if (order.expiresAt.getTime() - now.getTime() <= 45_000) {
          throw new ConflictException(
            "Order hold is expired or too close to expiry",
          );
        }

        const key = idempotencyKey
          ? `vnpay:${userId}:${idempotencyKey}`
          : `vnpay:${order.id}`;
        if (
          idempotencyKey &&
          !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(idempotencyKey)
        ) {
          throw new BadRequestException("Idempotency-Key must be a UUID");
        }
        const used = await tx.query.transactions.findFirst({
          where: eq(transactions.idempotencyKey, key),
        });
        if (used && used.orderId !== order.id)
          throw new ConflictException(
            "Idempotency key belongs to another order",
          );
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));
        const total = items.reduce(
          (sum, item) => sum + Number(item.subtotal),
          0,
        );
        const discount = Number(order.discountAmount);
        if (
          !items.length ||
          !Number.isSafeInteger(total) ||
          !Number.isSafeInteger(discount) ||
          discount < 0 ||
          total !== Number(order.totalAmount) ||
          total - discount !== Number(order.finalAmount) ||
          (discount > 0 && !order.voucherCode)
        )
          throw new ConflictException(
            "Order total or voucher discount is inconsistent",
          );

        // Tim giao dich VNPay da ton tai.
        // Khoa dong de tranh xu ly dong thoi.
        const [existingTransaction] = await tx
          .select({
            id: transactions.id,
            transactionRef: transactions.transactionRef,
            status: transactions.status,
            amount: transactions.amount,
            paymentUrl: transactions.paymentUrl,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.orderId, order.id),
              eq(transactions.provider, PaymentProvider.VNPAY),
            ),
          )
          .limit(1)
          .for("update");
        if (existingTransaction) {
          if (existingTransaction.status !== TransactionStatus.PENDING) {
            throw new ConflictException(
              "VNPay transaction is no longer pending",
            );
          }
          if (existingTransaction.amount !== order.finalAmount) {
            throw new ConflictException("Payment amount mismatch");
          }
        }

        // 3. Số tiền lấy từ PostgreSQL, không lấy
        // Lay so tien tu PostgreSQL.
        // Dung chung quy tac voi xu ly VNPay IPN.
        const amountVnd = parseVndAmount(order.finalAmount);
        if (amountVnd === null) {
          throw new BadRequestException("Invalid order amount for VNPay");
        }

        // 4. Mã giao dịch ngẫu nhiên, không chứa
        // dấu gạch ngang hoặc ký tự đặc biệt.
        const transactionRef =
          existingTransaction?.transactionRef ??
          "BE2" + randomBytes(12).toString("hex").toUpperCase();

        const gateway = new VnpayGateway();

        const rawIp = clientIp?.split(",")[0]?.trim() || "127.0.0.1";
        const ipAddress = isIP(rawIp) !== 0 ? rawIp : "127.0.0.1";

        // 5. Hạn thanh toán không vượt quá
        // thời gian giữ vé của Booking.
        const payment = existingTransaction?.paymentUrl
          ? { transactionRef, paymentUrl: existingTransaction.paymentUrl }
          : await gateway
              .createPaymentUrl({
                transactionRef,
                amountVnd,
                orderInfo: `TicketHub order ${order.orderCode}`,
                returnUrl: env.VNPAY_RETURN_URL,
                ipAddress,
                expiresAt: order.expiresAt,
              })
              .catch((error: unknown) => {
                if (
                  error instanceof Error &&
                  error.message.includes("credentials not configured")
                )
                  throw new ServiceUnavailableException(
                    "VNPay is not configured",
                  );
                throw error;
              });

        // 6. Lưu giao dịch trước khi trả URL
        // Chi INSERT khi chua co giao dich.
        // Neu da co giao dich PENDING, tai su dung
        // transactionRef cu, khong tao record moi.

        if (!existingTransaction) {
          await tx.insert(transactions).values({
            orderId: order.id,
            provider: PaymentProvider.VNPAY,
            transactionRef,
            amount: order.finalAmount,
            status: TransactionStatus.PENDING,
            idempotencyKey: key,
            paymentUrl: payment.paymentUrl,
            vnpCreateDate: new URL(payment.paymentUrl).searchParams.get(
              "vnp_CreateDate",
            ),
          });
        }

        if (existingTransaction && !existingTransaction.paymentUrl) {
          await tx
            .update(transactions)
            .set({
              paymentUrl: payment.paymentUrl,
              vnpCreateDate: new URL(payment.paymentUrl).searchParams.get(
                "vnp_CreateDate",
              ),
            })
            .where(eq(transactions.id, existingTransaction.id));
        }
        return {
          orderId: order.id,
          orderCode: order.orderCode,
          transactionRef: payment.transactionRef,
          paymentUrl: payment.paymentUrl,
          amountVnd,
          expiresAt: order.expiresAt.toISOString(),
        };
      })
      .catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "23505"
        )
          throw new ConflictException("Idempotency key is already in use");
        throw error;
      });
  }
}
