import type { RefundGateway } from "../domain/refund-gateway";
import {
  orderBecomesRefunded,
  parseRefundRequestedPayload,
  refundOrderInfo,
  refundRetryDelayMs,
  refundTransactionType,
  resolveOriginalTransactionDate,
  shouldRetryRefund,
  sumRefundVnd,
} from "../domain/refund-processing";
import type {
  RefundOutboxEvent,
  RefundProcessingStore,
} from "../domain/refund-processing.ports";

export interface ProcessLogger {
  log(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
}

export interface RefundProcessorConfig {
  ipAddress: string;
  createBy: string;
}

export interface RefundRunResult {
  found: number;
  completed: number;
  rejected: number;
  retried: number;
  uncertain: number;
  failed: number;
}

/**
 * Tieu thu su kien outbox REFUND_REQUESTED: goi API hoan tien VNPay (ngoai transaction DB)
 * roi hoan tat ban ghi hoan tien. Chi coi la thanh cong khi VNPay xac nhan hop le. Ket qua
 * khong chac chan thi giu PROCESSING de doi soat thu cong, khong bao gio tu gui lai.
 */
export class ProcessRefundRequestsUseCase {
  constructor(
    private readonly store: RefundProcessingStore,
    private readonly gateway: RefundGateway,
    private readonly config: RefundProcessorConfig,
    private readonly logger: ProcessLogger,
    private readonly query?: {
      queryTransaction(input: {
        transactionRef: string;
        transactionDate: string;
        ipAddress: string;
      }): Promise<Record<string, string>>;
    },
  ) {}

  async run(limit = 10): Promise<RefundRunResult> {
    const result: RefundRunResult = {
      found: 0,
      completed: 0,
      rejected: 0,
      retried: 0,
      uncertain: 0,
      failed: 0,
    };
    const events = await this.store.findPending(limit, new Date());
    result.found = events.length;
    this.logger.log(`[Refund] Found ${events.length} refund requests`);

    for (const event of events) {
      try {
        const outcome = await this.processOne(event);
        result[outcome]++;
      } catch (error) {
        // Loi khong du doan duoc sau khi da claim: giu PROCESSING de doi soat
        result.uncertain++;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`[Refund] Unexpected error ${event.id}: ${message}`);
        await this.store
          .annotateUncertain(
            event.id,
            `Unexpected error: ${message}`,
            new Date(),
          )
          .catch(() => undefined);
      }
    }

    this.logger.log("[Refund] Finished", result);
    return result;
  }

  private async processOne(
    event: RefundOutboxEvent,
  ): Promise<keyof Omit<RefundRunResult, "found">> {
    if (!(await this.store.claim(event.id, new Date()))) {
      this.logger.log(`[Refund] Already claimed: ${event.id}`);
      return "retried";
    }

    const payload = parseRefundRequestedPayload(event.payload);
    if (!payload) {
      await this.store.failEvent(
        event.id,
        "Invalid REFUND_REQUESTED payload",
        new Date(),
      );
      return "failed";
    }

    const ctx = await this.store.loadContext(payload, event.verifying);
    if (!ctx || ctx.pendingRefunds.length !== payload.refundIds.length) {
      await this.store.failEvent(
        event.id,
        "Missing successful VNPay transaction or pending refund rows",
        new Date(),
      );
      return "failed";
    }

    const amountVnd = sumRefundVnd(ctx.pendingRefunds.map((r) => r.amount));
    if (amountVnd <= 0) {
      await this.store.failEvent(
        event.id,
        "Refund amount must be positive",
        new Date(),
      );
      return "failed";
    }

    // Danh dau PROCESSING truoc khi goi VNPay: neu tien trinh chet giua chung se khong bi gui lai
    if (
      !event.verifying &&
      !(await this.store.markRefundsProcessing(payload.refundIds, new Date()))
    ) {
      await this.store.failEvent(
        event.id,
        "Refund rows are not PENDING",
        new Date(),
      );
      return "failed";
    }

    const request = {
      requestId: event.id.replace(/-/g, ""),
      transactionType: refundTransactionType(payload.isPartial),
      transactionRef: ctx.transaction.transactionRef,
      amountVnd,
      transactionDate: resolveOriginalTransactionDate(
        ctx.transaction.rawCallback,
        ctx.transaction.createdAt,
      ),
      transactionNo: ctx.transaction.providerTxNumber ?? "0",
      createBy: this.config.createBy,
      orderInfo: refundOrderInfo(event.id.replace(/-/g, "")),
      ipAddress: this.config.ipAddress,
    };
    const gatewayResult = event.verifying
      ? await this.verifyRefund(request)
      : await this.gateway.refund(request);

    switch (gatewayResult.kind) {
      case "SUCCESS":
        await this.store.complete({
          eventId: event.id,
          refundIds: payload.refundIds,
          orderId: payload.orderId,
          providerRefundRef: gatewayResult.providerRefundRef,
          orderBecomesRefunded: orderBecomesRefunded(ctx.order.status),
          now: new Date(),
        });
        this.logger.log(`[Refund] Completed ${event.id}`);
        return "completed";

      case "REJECTED":
        await this.store.reject({
          eventId: event.id,
          refundIds: payload.refundIds,
          message: `VNPay rejected refund (${gatewayResult.code}): ${gatewayResult.message}`,
          now: new Date(),
        });
        this.logger.warn(
          `[Refund] Rejected ${event.id} (${gatewayResult.code}). Manual handling required`,
        );
        return "rejected";

      case "UNREACHABLE": {
        const attempt = event.retryCount + 1;
        const giveUp = !shouldRetryRefund(attempt);
        await this.store.releaseForRetry({
          eventId: event.id,
          refundIds: payload.refundIds,
          retryCount: attempt,
          nextRetryAt: new Date(Date.now() + refundRetryDelayMs(attempt)),
          giveUp,
          message: `VNPay unreachable: ${gatewayResult.reason}`,
          now: new Date(),
        });
        this.logger.warn(
          `[Refund] ${giveUp ? "Gave up" : "Will retry"} ${event.id}: ${gatewayResult.reason}`,
        );
        return giveUp ? "failed" : "retried";
      }

      default: {
        const attempts = event.retryCount + 1;
        if (this.query && this.store.scheduleVerification) {
          if (shouldRetryRefund(attempts)) {
            await this.store.scheduleVerification(
              event.id,
              attempts,
              new Date(Date.now() + refundRetryDelayMs(attempts)),
            );
            return "retried";
          }
          await this.store.failEvent(
            event.id,
            "REFUND_QUERYDR_MANUAL_REVIEW",
            new Date(),
          );
          this.logger.error(`[Refund] Manual review required: ${event.id}`);
          return "failed";
        }
        await this.store.annotateUncertain(
          event.id,
          `Uncertain outcome, manual reconciliation required: ${gatewayResult.reason}`,
          new Date(),
        );
        this.logger.warn(
          `[Refund] Uncertain outcome ${event.id}: ${gatewayResult.reason}. NOT retrying automatically`,
        );
        return "uncertain";
      }
    }
  }
  private async verifyRefund(
    request: Parameters<RefundGateway["refund"]>[0],
  ): ReturnType<RefundGateway["refund"]> {
    try {
      const result = await this.query?.queryTransaction(request);
      if (
        result?.vnp_ResponseCode === "00" &&
        result.vnp_TransactionStatus === "00" &&
        result.vnp_TransactionType === request.transactionType &&
        result.vnp_Amount === String(request.amountVnd * 100) &&
        (request.transactionType !== "03" ||
          result.vnp_OrderInfo === request.orderInfo) &&
        /^\d{1,15}$/.test(result.vnp_TransactionNo ?? "")
      ) {
        return {
          kind: "SUCCESS",
          providerRefundRef: result.vnp_TransactionNo!,
        };
      }
    } catch {
      // Chưa xác minh được kết quả. Không gọi lại Refund.
    }
    return {
      kind: "UNKNOWN",
      reason: "Refund requires verified QueryDR evidence",
    };
  }
}
