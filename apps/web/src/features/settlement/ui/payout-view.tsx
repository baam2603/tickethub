"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GeneratePayoutSchema,
  HoldPayoutSchema,
  PayoutFilterQuerySchema,
  type PayoutStatus,
} from "@tickethub/shared";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/shared/ui/dialog";
import { PageNavigation } from "@/shared/ui/page-navigation";
import { formatDateTimeVi, formatVndCurrency } from "@/shared/lib/format-vi";
import {
  generatePayout,
  getPayouts,
  updatePayout,
} from "../api/settlement-api";
import type { PayoutRow } from "../domain/settlement.types";

type PayoutAction = "approve" | "hold" | "recalculate";
type Selection = { row: PayoutRow; action: PayoutAction };

const statusLabels: Record<PayoutStatus, string> = {
  PENDING: "Chờ phê duyệt",
  HOLD: "Đang tạm giữ",
  PAID_OUT: "Đã chi trả",
};
const actions: Record<PayoutAction, string> = {
  approve: "Phê duyệt chi trả",
  hold: "Tạm giữ",
  recalculate: "Tính lại",
};

export function PayoutView() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [eventInput, setEventInput] = useState("");
  const [organizerInput, setOrganizerInput] = useState("");
  const [filters, setFilters] = useState<{
    eventId?: string;
    organizerId?: string;
  }>({});
  const [eventToGenerate, setEventToGenerate] = useState("");
  const [filterError, setFilterError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<Selection | null>(null);
  const payouts = useQuery({
    queryKey: ["adminPayouts", status, filters, page],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      if (filters.eventId) params.set("eventId", filters.eventId);
      if (filters.organizerId) params.set("organizerId", filters.organizerId);
      return getPayouts(params, signal);
    },
    retry: false,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["adminPayouts"] });
  const generate = useMutation({
    mutationFn: generatePayout,
    onSuccess: async () => {
      setEventToGenerate("");
      setStatus("");
      setEventInput("");
      setOrganizerInput("");
      setFilters({});
      setFilterError("");
      setPage(1);
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: ({ row, action, reason }: Selection & { reason: string }) =>
      updatePayout(row.id, action, reason),
    onSuccess: async () => {
      setSelection(null);
      await refresh();
    },
    onError: refresh,
  });
  const busy = generate.isPending || update.isPending;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Lệnh chi trả ban tổ chức</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const result = PayoutFilterQuerySchema.safeParse({
            eventId: eventInput.trim() || undefined,
            organizerId: organizerInput.trim() || undefined,
          });
          if (!result.success) {
            setFilterError(
              "Mã sự kiện và mã hồ sơ ban tổ chức phải là UUID hợp lệ.",
            );
            return;
          }
          const { eventId, organizerId } = result.data;
          setFilters({ eventId, organizerId });
          setFilterError("");
          setPage(1);
        }}
      >
        <label className="grid gap-1.5 text-sm">
          Trạng thái chi trả
          <select
            value={status}
            className="h-9 rounded-md border bg-background px-2"
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả</option>
            {(Object.keys(statusLabels) as PayoutStatus[]).map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          Mã sự kiện (UUID)
          <Input
            value={eventInput}
            onChange={(event) => setEventInput(event.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          Mã hồ sơ ban tổ chức (UUID)
          <Input
            value={organizerInput}
            onChange={(event) => setOrganizerInput(event.target.value)}
          />
        </label>
        <Button variant="outline">Áp dụng</Button>
        {(filters.eventId || filters.organizerId) && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setEventInput("");
              setOrganizerInput("");
              setFilters({});
              setPage(1);
              setFilterError("");
            }}
          >
            Xóa bộ lọc
          </Button>
        )}
      </form>
      {filterError && (
        <p className="text-destructive" role="alert">
          {filterError}
        </p>
      )}
      <form
        className="flex flex-wrap items-end gap-3 rounded-md border bg-background p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          generate.reset();
          const result = GeneratePayoutSchema.safeParse({
            eventId: eventToGenerate.trim(),
          });
          if (!result.success) {
            setGenerateError(result.error.issues[0].message);
            return;
          }
          setGenerateError("");
          generate.mutate(result.data.eventId);
        }}
      >
        <label className="grid gap-1.5 text-sm">
          Mã sự kiện cần quyết toán
          <Input
            value={eventToGenerate}
            required
            onChange={(event) => {
              setEventToGenerate(event.target.value);
              setGenerateError("");
            }}
          />
        </label>
        <Button disabled={busy}>
          {generate.isPending ? "Đang tính..." : "Tạo lệnh quyết toán"}
        </Button>
      </form>
      {(generateError || generate.isError) && (
        <p role="alert" className="text-destructive">
          {generateError || generate.error?.message}
        </p>
      )}
      {generate.isSuccess && <p role="status">Đã cập nhật lệnh quyết toán.</p>}
      {update.isSuccess && <p role="status">Đã cập nhật lệnh chi trả.</p>}
      {payouts.isPending && <p role="status">Đang tải lệnh chi trả...</p>}
      {payouts.isError && (
        <p role="alert" className="text-destructive">
          {payouts.error.message}
        </p>
      )}
      {payouts.data && (
        <>
          {payouts.data.items.length === 0 && (
            <p>Không có lệnh chi trả phù hợp.</p>
          )}
          <ul className="space-y-3">
            {payouts.data.items.map((row) => (
              <li
                key={row.id}
                className="space-y-3 rounded-md border bg-background p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{row.eventTitle}</h3>
                    <p className="text-sm text-muted-foreground">
                      {row.organizationName}
                    </p>
                  </div>
                  <span className="rounded bg-muted px-2 py-1 text-xs font-semibold">
                    {statusLabels[row.status]}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 xl:grid-cols-5">
                  {(
                    [
                      ["Doanh thu", row.totalRevenue],
                      ["Hoàn vé", row.refundDeduction],
                      ["Phí nền tảng", row.platformFee],
                      ["Phí VNPay", row.gatewayFee],
                      ["Thực chi", row.netPayout],
                    ] as const
                  ).map(([label, amount]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">
                        {formatVndCurrency(amount)}
                      </dd>
                    </div>
                  ))}
                </dl>
                {row.holdReason && (
                  <p className="break-words text-sm">
                    Lý do tạm giữ: {row.holdReason}
                  </p>
                )}
                {row.paidOutAt && (
                  <p className="text-sm">
                    Thời điểm xác nhận: {formatDateTimeVi(row.paidOutAt)}
                  </p>
                )}
                {row.status !== "PAID_OUT" && (
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(actions) as PayoutAction[]).map((action) => (
                      <Button
                        key={action}
                        type="button"
                        variant={action === "approve" ? "default" : "outline"}
                        disabled={busy || payouts.isFetching}
                        onClick={() => {
                          update.reset();
                          setSelection({ row, action });
                        }}
                      >
                        {actions[action]}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <PageNavigation
            page={page}
            hasMore={page < payouts.data.meta.totalPages}
            onChange={setPage}
          />
        </>
      )}
      {selection && (
        <PayoutConfirmation
          selection={selection}
          busy={update.isPending}
          error={update.error?.message}
          onClose={() => setSelection(null)}
          onConfirm={(reason) => update.mutate({ ...selection, reason })}
        />
      )}
    </div>
  );
}

function PayoutConfirmation({
  selection,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  selection: Selection;
  busy: boolean;
  error: string | undefined;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const { row, action } = selection;
  const holding = action === "hold";
  const description =
    action === "approve"
      ? `Xác nhận số tiền ${formatVndCurrency(row.netPayout)}. Hệ thống sẽ ghi nhận lệnh là đã chi trả.`
      : action === "recalculate"
        ? "Hệ thống sẽ cập nhật doanh thu, tiền hoàn và các khoản phí."
        : "Nhập lý do để lưu cùng lệnh chi trả.";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogTitle>{actions[action]}</DialogTitle>
        <DialogDescription className="break-words">
          {row.eventTitle}. {description}
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            const trimmed = reason.trim();
            if (
              !holding ||
              HoldPayoutSchema.safeParse({ reason: trimmed }).success
            )
              onConfirm(trimmed);
          }}
        >
          {holding && (
            <label className="grid gap-1.5">
              Lý do tạm giữ
              <textarea
                required
                maxLength={500}
                rows={3}
                value={reason}
                className="rounded-md border bg-background p-2"
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Hủy
            </Button>
            <Button disabled={busy || (holding && !reason.trim())}>
              {busy ? "Đang xử lý..." : "Xác nhận"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
