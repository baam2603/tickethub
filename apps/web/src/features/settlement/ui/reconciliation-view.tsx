"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  GeneratePayoutSchema,
  ReconciliationStatusEnum,
  type ReconciliationStatus,
} from "@tickethub/shared";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageNavigation } from "@/shared/ui/page-navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import {
  formatDateTimeVi,
  formatNumberVi,
  formatVndCurrency,
} from "@/shared/lib/format-vi";
import { getReconciliations } from "../api/settlement-api";

const labels: Record<ReconciliationStatus, string> = {
  MATCHED: "Khớp",
  AMOUNT_MISMATCH: "Lệch số tiền",
  MISSING_TRANSACTION: "Thiếu giao dịch",
  ORPHAN_TRANSACTION: "Thiếu đơn hàng tương ứng",
};

export function ReconciliationView() {
  const [status, setStatus] = useState("ALL");
  const [eventInput, setEventInput] = useState("");
  const [eventId, setEventId] = useState("");
  const [invalidId, setInvalidId] = useState(false);
  const [page, setPage] = useState(1);
  const report = useQuery({
    queryKey: ["adminReconciliations", status, eventId, page],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ status, page: String(page) });
      if (eventId) params.set("eventId", eventId);
      return getReconciliations(params, signal);
    },
    retry: false,
  });
  const summary = report.data?.summary;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Đối soát giao dịch VNPay</h2>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1.5 text-sm">
          Trạng thái đối soát
          <select
            value={status}
            className="h-9 rounded-md border bg-background px-2"
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">Tất cả</option>
            {ReconciliationStatusEnum.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        </label>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const id = eventInput.trim();
            const invalid =
              Boolean(id) &&
              !GeneratePayoutSchema.safeParse({ eventId: id }).success;
            setInvalidId(invalid);
            if (invalid) return;
            setEventId(id);
            setPage(1);
          }}
        >
          <label className="grid gap-1.5 text-sm">
            Mã sự kiện (UUID)
            <Input
              value={eventInput}
              aria-invalid={invalidId}
              onChange={(event) => {
                setEventInput(event.target.value);
                setInvalidId(false);
              }}
            />
          </label>
          <Button variant="outline">Áp dụng</Button>
          {eventId && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEventInput("");
                setEventId("");
                setPage(1);
                setInvalidId(false);
              }}
            >
              Xóa bộ lọc
            </Button>
          )}
        </form>
      </div>
      {invalidId && (
        <p role="alert" className="text-destructive">
          Mã sự kiện không hợp lệ.
        </p>
      )}
      {report.isPending && <p role="status">Đang tải đối soát...</p>}
      {report.isError && (
        <p role="alert" className="text-destructive">
          {report.error.message}
        </p>
      )}
      {report.data && summary && (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {[
              ["Bản ghi", formatNumberVi(summary.totalTransactions)],
              ["Khớp", formatNumberVi(summary.matchedCount)],
              ["Có sai lệch", formatNumberVi(summary.mismatchedCount)],
              ["Tổng giá trị đơn", formatVndCurrency(summary.totalOrderAmount)],
              [
                "Tổng đã thanh toán",
                formatVndCurrency(summary.totalPaidAmount),
              ],
              ["Tổng hoàn vé", formatVndCurrency(summary.totalRefundedAmount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border bg-background p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="rounded-md border bg-background">
            <Table aria-label="Giao dịch đối soát">
              <TableHeader>
                <TableRow>
                  <TableHead>Đơn hàng / sự kiện</TableHead>
                  <TableHead>Mã VNPay</TableHead>
                  <TableHead>Giá trị đơn</TableHead>
                  <TableHead>Đã thanh toán</TableHead>
                  <TableHead>Tiền hoàn</TableHead>
                  <TableHead>Trạng thái</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.items.map((row) => (
                  <TableRow
                    key={
                      row.orderId ?? row.transactionRef ?? row.providerTxNumber
                    }
                  >
                    <TableCell>
                      {row.orderCode ?? "-"}
                      <div className="whitespace-normal text-muted-foreground">
                        {row.eventTitle}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.transactionRef ?? "-"}
                      <div className="text-muted-foreground">
                        {row.providerTxNumber}{" "}
                        {row.payDate && formatDateTimeVi(row.payDate)}
                      </div>
                    </TableCell>
                    <TableCell>{formatVndCurrency(row.orderAmount)}</TableCell>
                    <TableCell>{formatVndCurrency(row.paidAmount)}</TableCell>
                    <TableCell>
                      {formatVndCurrency(row.refundedAmount)}
                    </TableCell>
                    <TableCell
                      className={
                        row.reconciliationStatus === "MATCHED"
                          ? "text-emerald-700"
                          : "text-destructive"
                      }
                    >
                      {labels[row.reconciliationStatus]}
                    </TableCell>
                  </TableRow>
                ))}
                {report.data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      Không có giao dịch phù hợp.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <PageNavigation
            page={page}
            hasMore={page < report.data.meta.totalPages}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
