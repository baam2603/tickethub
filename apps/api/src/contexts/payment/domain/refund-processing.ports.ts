import type { RefundRequestedPayload } from "./refund-processing";

export interface RefundOutboxEvent {
  id: string;
  payload: unknown;
  retryCount: number;
  verifying?: boolean;
}

export interface RefundOrderContext {
  order: { id: string; orderCode: string; status: string };
  transaction: {
    transactionRef: string;
    providerTxNumber: string | null;
    createdAt: Date;
    rawCallback: unknown;
  };
  /** Cac ban ghi hoan tien o trang thai PENDING thuoc su kien. */
  pendingRefunds: Array<{ id: string; amount: string }>;
}

/**
 * Kho xu ly hoan tien. Moi thao tac chuyen trang thai la cap nhat co dieu kien de nhieu tien trinh
 * khong xu ly trung; viec hoan tat (refund, outbox, don hang) nam trong mot transaction.
 */
export interface RefundProcessingStore {
  findPending(limit: number, now: Date): Promise<RefundOutboxEvent[]>;
  /** PENDING -> PROCESSING; false neu tien trinh khac da nhan. */
  claim(eventId: string, now: Date): Promise<boolean>;
  loadContext(
    payload: RefundRequestedPayload,
    verifying?: boolean,
  ): Promise<RefundOrderContext | null>;
  /** PENDING -> PROCESSING cho cac ban ghi hoan tien; false neu so dong khong khop. */
  markRefundsProcessing(refundIds: string[], now: Date): Promise<boolean>;
  /** Hoan tat trong mot transaction: refunds COMPLETED, outbox COMPLETED, don -> REFUNDED neu can. */
  complete(input: {
    eventId: string;
    refundIds: string[];
    orderId: string;
    providerRefundRef: string;
    orderBecomesRefunded: boolean;
    now: Date;
  }): Promise<void>;
  /** Tu choi ro rang: refunds FAILED, outbox FAILED (can xu ly thu cong). */
  reject(input: {
    eventId: string;
    refundIds: string[];
    message: string;
    now: Date;
  }): Promise<void>;
  /**
   * Chua gui toi VNPay: tra refunds ve PENDING. Neu con luot thu thi hen thu lai outbox,
   * neu `giveUp` thi dat outbox FAILED de doi soat thu cong.
   */
  releaseForRetry(input: {
    eventId: string;
    refundIds: string[];
    retryCount: number;
    nextRetryAt: Date;
    giveUp: boolean;
    message: string;
    now: Date;
  }): Promise<void>;
  /** Het so lan thu hoac du lieu khong hop le: outbox FAILED (refunds giu nguyen de doi soat). */
  failEvent(eventId: string, message: string, now: Date): Promise<void>;
  scheduleVerification?(
    eventId: string,
    attempts: number,
    nextRetryAt: Date,
  ): Promise<void>;
  /** Ket qua khong chac chan: chi ghi chu loi, giu PROCESSING de doi soat thu cong. */
  annotateUncertain(eventId: string, message: string, now: Date): Promise<void>;
}
