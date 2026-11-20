import type { VnpayReportRow } from "../domain/reconciliation-model";
import { BadRequestException } from "@nestjs/common";

export const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_REPORT_ROWS = 20_000;

export function parseVnpayReport(csv: string): VnpayReportRow[] {
  if (Buffer.byteLength(csv, "utf8") > MAX_REPORT_BYTES) {
    throw new BadRequestException("VNPAY_REPORT_TOO_LARGE");
  }
  const [header, ...lines] = csv
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/);
  const columns = (line: string) =>
    line.split(",").map((cell) => cell.trim().replace(/^"([^"]*)"$/, "$1"));
  if (
    !header ||
    columns(header).join(",") !==
      "vnp_TxnRef,vnp_TransactionNo,vnp_Amount,vnp_TransactionType"
  ) {
    throw new BadRequestException("INVALID_VNPAY_REPORT_HEADER");
  }
  if (lines.length > MAX_REPORT_ROWS)
    throw new BadRequestException("VNPAY_REPORT_TOO_LARGE");

  const seen = new Set<string>();
  const paymentRefs = new Set<string>();
  return lines.map((line, index) => {
    const cells = columns(line);
    const [ref = "", number = "", rawAmount = "", type = ""] = cells;
    const amount =
      /^\d{1,12}$/.test(rawAmount) && rawAmount.endsWith("00")
        ? Number(rawAmount) / 100
        : null;
    const kind = type === "01" ? "PAYMENT" : "REFUND";
    if (
      cells.length !== 4 ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(ref) ||
      !/^\d{1,15}$/.test(number) ||
      amount === null ||
      amount <= 0 ||
      (type !== "01" && type !== "02" && type !== "03")
    ) {
      throw new BadRequestException(`INVALID_VNPAY_REPORT_ROW: ${index + 2}`);
    }
    const key = `${kind}:${number}`;
    if (seen.has(key) || (kind === "PAYMENT" && paymentRefs.has(ref))) {
      throw new BadRequestException(`DUPLICATE_VNPAY_REPORT_ROW: ${index + 2}`);
    }
    seen.add(key);
    if (kind === "PAYMENT") paymentRefs.add(ref);
    return { kind, ref, number, amount, transactionType: type };
  });
}
