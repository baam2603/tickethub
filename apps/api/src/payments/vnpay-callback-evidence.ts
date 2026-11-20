const evidenceFields = [
  "vnp_TxnRef",
  "vnp_Amount",
  "vnp_ResponseCode",
  "vnp_TransactionStatus",
  "vnp_TransactionNo",
  "vnp_PayDate",
  "vnp_BankCode",
] as const;

export function vnpayCallbackEvidence(params: Record<string, string>) {
  return Object.fromEntries(
    evidenceFields.map((name) => [name, params[name] ?? null]),
  );
}
