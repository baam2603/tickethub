import type {
  PaymentOrder,
  PaymentTransaction,
  PendingVnpayTransaction,
  SettlementImpact,
  SettlementItem,
  VnpayParams,
} from "./payment.models";

/** Giao dich DB cua luong tao URL thanh toan. */
export interface CheckoutTransaction {
  /** Khoa don hang cua chinh nguoi mua (FOR UPDATE) de tranh tao hai giao dich. */
  lockOwnedOrder(userId: string, orderId: string): Promise<PaymentOrder | null>;
  claimIdempotencyKey(key: string, orderId: string): Promise<void>;
  lockVnpayTransaction(
    orderId: string,
  ): Promise<PendingVnpayTransaction | null>;
  insertPendingTransaction(input: {
    orderId: string;
    transactionRef: string;
    amount: string;
    idempotencyKey: string;
    /** vnp_CreateDate cua URL thanh toan dau tien, luu de dung khi hoan tien. */
    createDate: string;
    paymentUrl: string;
  }): Promise<void>;
}

export interface CheckoutUnitOfWork {
  run<T>(work: (tx: CheckoutTransaction) => Promise<T>): Promise<T>;
}

/** Giao dich DB cua luong xu ly IPN. */
export interface IpnTransaction {
  /** Thu tu khoa: don hang truoc, giao dich sau (tuong thich voi Booking Cleanup). */
  lockOrder(orderId: string): Promise<PaymentOrder | null>;
  lockTransaction(transactionId: string): Promise<PaymentTransaction | null>;
  hasManualReviewAudit(transactionId: string): Promise<boolean>;
  recordManualReview(input: {
    transaction: PaymentTransaction;
    order: PaymentOrder;
    params: VnpayParams;
    providerTxNumber: string | null;
  }): Promise<void>;
  findOrderItems(orderId: string): Promise<SettlementItem[]>;
  /** Chuyen ghe HELD cua don sang SOLD (hoac AVAILABLE khi that bai); false neu khong cap nhat dung 1 ghe. */
  settleSeat(
    order: PaymentOrder,
    item: SettlementItem,
    sold: boolean,
    now: Date,
  ): Promise<boolean>;
  /** Giam held_count (va tang sold_count khi thanh cong) cua ve dung; false neu ton kho bat nhat. */
  settleStanding(
    order: PaymentOrder,
    item: SettlementItem,
    sold: boolean,
    now: Date,
  ): Promise<boolean>;
  completeTransaction(input: {
    transactionId: string;
    success: boolean;
    params: VnpayParams;
    providerTxNumber: string | null;
    now: Date;
  }): Promise<void>;
  completeOrder(orderId: string, paid: boolean, now: Date): Promise<void>;
  /** Trang thai su kien (null neu khong ton tai); dung de quyet dinh khoi phuc ve hay hoan tien. */
  findEventStatus(eventId: string): Promise<string | null>;
  /**
   * Thanh toan muon: khoa ghe / hang ve (theo id tang dan), kiem tra toan bo con dung duoc,
   * neu du thi chuyen ghe SOLD / tang sold_count va tra true; neu khong thi khong thay doi gi, tra false.
   */
  tryRestoreOrder(
    order: PaymentOrder,
    items: SettlementItem[],
    now: Date,
  ): Promise<boolean>;
  /**
   * Thanh toan muon khong khoi phuc duoc: don -> PAYMENT_EXPIRED_REFUND_PENDING, tao ban ghi hoan tien
   * 100% (PENDING), ghi outbox REFUND_REQUESTED va email giai thich, ghi audit log.
   */
  requestLateRefund(input: {
    order: PaymentOrder;
    transaction: PaymentTransaction;
    now: Date;
  }): Promise<void>;
  /** Ghi audit log cho thanh toan muon duoc khoi phuc. */
  recordLateRestored(input: {
    order: PaymentOrder;
    transaction: PaymentTransaction;
    now: Date;
  }): Promise<void>;
  /** Cap ve SOLD va ghi outbox ORDER_PAID trong cung transaction. */
  issueTicketsWithOutbox(input: {
    order: PaymentOrder;
    transaction: PaymentTransaction;
    items: SettlementItem[];
    now: Date;
  }): Promise<void>;
}

export interface IpnUnitOfWork {
  run<T>(work: (tx: IpnTransaction) => Promise<T>): Promise<T>;
}

export interface PaymentQueryPort {
  findVnpayTransactionByRef(
    transactionRef: string,
  ): Promise<PaymentTransaction | null>;
  /** Tim theo ma giao dich bat ke nha cung cap (dung cho preview). */
  findTransactionByRef(
    transactionRef: string,
  ): Promise<PaymentTransaction | null>;
  findOrder(orderId: string): Promise<PaymentOrder | null>;
  findSettlementImpact(orderId: string): Promise<SettlementImpact | null>;
}

/** Thong bao sau commit cho context Event (xoa cache, phat SSE). */
export interface SettlementNotifier {
  orderSettled(impact: SettlementImpact, paid: boolean): Promise<void>;
}
