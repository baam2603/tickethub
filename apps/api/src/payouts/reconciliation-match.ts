import { ReconciliationStatus } from "@tickethub/shared";
import type { ReconciliationItem } from "./reconciliation-items";
import type {
  lockSettlementEvent,
  readSettlementLedger,
} from "./settlement-ledger";
import type { VnpayReportRow } from "./vnpay-report";

export function matchReconciliation(
  event: Awaited<ReturnType<typeof lockSettlementEvent>>,
  ledger: Awaited<ReturnType<typeof readSettlementLedger>>,
  report: VnpayReportRow[],
): ReconciliationItem[] {
  const paymentRows = new Map(
    report.filter((row) => row.kind === "PAYMENT").map((row) => [row.ref, row]),
  );
  const refundRows = new Map(
    report
      .filter((row) => row.kind === "REFUND")
      .map((row) => [row.number, row]),
  );
  const localPayments = new Map<string, typeof ledger.payments>();
  const consumed = new Set<VnpayReportRow>();
  const items: ReconciliationItem[] = [];
  const base: ReconciliationItem = {
    eventId: event.id,
    eventTitle: event.title,
    orderId: null,
    orderCode: null,
    orderAmount: 0,
    paidAmount: 0,
    refundedAmount: 0,
    transactionRef: null,
    providerTxNumber: null,
    bankCode: null,
    payDate: null,
    gatewayAmount: null,
    reconciliationStatus: ReconciliationStatus.MATCHED,
    kind: "PAYMENT",
    issue: null,
  };
  const orders = new Map(ledger.eventOrders.map((order) => [order.id, order]));
  for (const payment of ledger.payments) {
    if (payment.status !== "SUCCESS") continue;
    const entries = localPayments.get(payment.orderId) ?? [];
    entries.push(payment);
    localPayments.set(payment.orderId, entries);
  }

  for (const payment of ledger.payments) {
    if (payment.status === "SUCCESS" || !payment.providerSuccessEvidence)
      continue;
    const order = orders.get(payment.orderId)!;
    const gateway = paymentRows.get(payment.ref);
    if (gateway) consumed.add(gateway);
    items.push({
      ...base,
      orderId: order.id,
      orderCode: order.code,
      transactionRef: payment.ref,
      providerTxNumber: payment.number,
      gatewayAmount: gateway?.amount ?? null,
      reconciliationStatus: ReconciliationStatus.MISSING_TRANSACTION,
      issue: "VERIFIED_PAYMENT_NOT_SETTLED",
    });
  }

  const providerNumbers = new Set<string>();
  for (const order of ledger.eventOrders) {
    const payments = localPayments.get(order.id) ?? [];
    const orderAmount = Number(order.amount);
    const expectsPayment = [
      "PAID",
      "REFUNDED",
      "PAYMENT_EXPIRED_REFUND_PENDING",
    ].includes(order.status);
    if (!payments.length && (expectsPayment || order.status === "PENDING")) {
      items.push({
        ...base,
        orderId: order.id,
        orderCode: order.code,
        orderAmount,
        reconciliationStatus: ReconciliationStatus.MISSING_TRANSACTION,
        issue: expectsPayment ? "LOCAL_PAYMENT_MISSING" : "ORDER_UNRESOLVED",
      });
    }
    for (const [index, payment] of payments.entries()) {
      const gateway = paymentRows.get(payment.ref);
      if (gateway) consumed.add(gateway);
      const paidAmount = Number(payment.amount);
      const duplicateNumber =
        payment.number !== null && providerNumbers.has(payment.number);
      if (payment.number !== null) providerNumbers.add(payment.number);
      let issue = null;
      if (payments.length > 1 || duplicateNumber)
        issue = "DUPLICATE_LOCAL_PAYMENT";
      else if (!expectsPayment) issue = "UNEXPECTED_ORDER_STATUS";
      else if (paidAmount !== orderAmount)
        issue = "LOCAL_ORDER_AMOUNT_MISMATCH";
      else if (!gateway) issue = "GATEWAY_PAYMENT_MISSING";
      else if (gateway.amount !== paidAmount) issue = "GATEWAY_AMOUNT_MISMATCH";
      else if (gateway.number !== payment.number)
        issue = "PROVIDER_NUMBER_MISMATCH";
      items.push({
        ...base,
        orderId: order.id,
        orderCode: order.code,
        orderAmount: index === 0 ? orderAmount : 0,
        paidAmount,
        transactionRef: payment.ref,
        providerTxNumber: payment.number,
        bankCode: payment.bankCode,
        payDate: payment.payDate?.toISOString() ?? null,
        gatewayAmount: gateway?.amount ?? null,
        issue,
        reconciliationStatus: !issue
          ? ReconciliationStatus.MATCHED
          : issue === "GATEWAY_PAYMENT_MISSING"
            ? ReconciliationStatus.MISSING_TRANSACTION
            : ReconciliationStatus.AMOUNT_MISMATCH,
      });
    }
  }

  const refundTotals = new Map<string, number>();
  const refundNumbers = new Set<string>();
  for (const refund of ledger.eventRefunds) {
    const order = orders.get(refund.orderId)!;
    const payments = localPayments.get(order.id) ?? [];
    const payment = payments[0];
    const completed = refund.status === "COMPLETED";
    const refundedAmount = completed ? Number(refund.amount) : 0;
    const runningTotal = (refundTotals.get(order.id) ?? 0) + refundedAmount;
    refundTotals.set(order.id, runningTotal);
    const gateway =
      completed && refund.number ? refundRows.get(refund.number) : undefined;
    if (gateway) consumed.add(gateway);
    const duplicateNumber =
      refund.number !== null && refundNumbers.has(refund.number);
    if (completed && refund.number !== null) refundNumbers.add(refund.number);
    let issue = null;
    if (!completed) issue = "REFUND_UNRESOLVED";
    else if (duplicateNumber) issue = "DUPLICATE_LOCAL_REFUND";
    else if (payments.length !== 1 || runningTotal > Number(payment?.amount))
      issue = "LOCAL_REFUND_INCONSISTENT";
    else if (!gateway) issue = "GATEWAY_REFUND_MISSING";
    else if (gateway.amount !== refundedAmount)
      issue = "GATEWAY_AMOUNT_MISMATCH";
    else if (gateway.ref !== payment?.ref)
      issue = "REFUND_PAYMENT_REFERENCE_MISMATCH";
    items.push({
      ...base,
      kind: "REFUND",
      orderId: order.id,
      orderCode: order.code,
      refundedAmount,
      transactionRef: payment?.ref ?? null,
      providerTxNumber: refund.number,
      payDate: refund.processedAt?.toISOString() ?? null,
      gatewayAmount: gateway?.amount ?? null,
      issue,
      reconciliationStatus: !issue
        ? ReconciliationStatus.MATCHED
        : issue === "GATEWAY_REFUND_MISSING" || issue === "REFUND_UNRESOLVED"
          ? ReconciliationStatus.MISSING_TRANSACTION
          : ReconciliationStatus.AMOUNT_MISMATCH,
    });
  }

  for (const order of ledger.eventOrders) {
    if (
      order.status === "PAYMENT_EXPIRED_REFUND_PENDING" ||
      (order.status === "REFUNDED" && !refundTotals.has(order.id))
    ) {
      items.push({
        ...base,
        kind: "REFUND",
        orderId: order.id,
        orderCode: order.code,
        issue: "REFUND_ORDER_UNRESOLVED",
        reconciliationStatus: ReconciliationStatus.MISSING_TRANSACTION,
      });
    }
  }

  for (const row of report) {
    if (consumed.has(row)) continue;
    items.push({
      ...base,
      kind: row.kind,
      transactionRef: row.ref,
      providerTxNumber: row.number,
      gatewayAmount: row.amount,
      issue: "LOCAL_TRANSACTION_MISSING",
      reconciliationStatus: ReconciliationStatus.ORPHAN_TRANSACTION,
    });
  }
  return items;
}
