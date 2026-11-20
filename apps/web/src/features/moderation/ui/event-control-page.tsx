"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, RotateCcw, ShieldAlert } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EventControlQuerySchema,
  EventKillSwitchRequestSchema,
  EventResumeRequestSchema,
  type EventControlItem,
  type EventKillSwitchData,
} from "@tickethub/shared";
import { ApiError } from "@/shared/api/client";
import { formatDateTimeVi } from "@/shared/lib/format-vi";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { AdminEventPoster } from "./admin-event-poster";
import { EventControlStatus } from "./event-control-status";
import { PageNavigation } from "@/shared/ui/page-navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  activateKillSwitch,
  getEventAuditLogs,
  getEventControls,
  resumeEvent,
} from "../api/event-control-api";

type EventAction = {
  kind: "suspend" | "resume";
  version: number;
  reason?: string;
};

const auditLabels: Record<string, string> = {
  EVENT_KILL_SWITCH_ACTIVATED: "Tạm dừng bán vé",
  EVENT_RESUMED: "Khôi phục mở bán",
  EVENT_APPROVED: "Duyệt sự kiện",
  EVENT_REJECTED: "Từ chối sự kiện",
};

export function EventControlPage({ eventId }: { eventId: string }) {
  const validId = EventControlQuerySchema.safeParse({ eventId }).success;
  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="space-y-3">
        <Button
          asChild
          variant="outline"
          className="min-h-10 rounded-full px-4"
        >
          <Link href="/admin/events/control">
            <ArrowLeft aria-hidden="true" />
            Quay lại danh sách sự kiện
          </Link>
        </Button>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Điều khiển khẩn cấp
        </h1>
      </header>
      {validId ? (
        <EventControl key={eventId} eventId={eventId} />
      ) : (
        <p role="alert">Mã sự kiện không hợp lệ.</p>
      )}
    </section>
  );
}

function EventControl({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState<{
    kind: EventAction["kind"];
    version: number;
  } | null>(null);
  const [result, setResult] = useState<EventKillSwitchData | "resumed" | null>(
    null,
  );
  const event = useQuery({
    queryKey: ["adminEventControl", eventId],
    queryFn: ({ signal }) =>
      getEventControls(new URLSearchParams({ eventId }), signal),
    retry: false,
  });
  const item = event.data?.items[0];
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["adminEventControl", eventId],
      }),
      queryClient.invalidateQueries({ queryKey: ["adminEventControls"] }),
      queryClient.invalidateQueries({ queryKey: ["adminEventAudit", eventId] }),
    ]);
  const mutation = useMutation({
    mutationFn: async ({ kind, version, reason }: EventAction) =>
      kind === "suspend"
        ? activateKillSwitch(
            eventId,
            EventKillSwitchRequestSchema.parse({ version, reason }),
          )
        : resumeEvent(
            eventId,
            EventResumeRequestSchema.parse({ version, reason }),
          ),
    onSuccess: async (response) => {
      setConfirmation(null);
      setResult(
        "cancelledPendingOrdersCount" in response ? response : "resumed",
      );
      await refresh();
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409) {
        setConfirmation(null);
        await refresh();
      }
    },
  });

  if (event.isPending) return <p role="status">Đang tải sự kiện...</p>;
  if (event.isError)
    return (
      <p role="alert" className="text-destructive">
        {event.error.message}
      </p>
    );
  if (!item) return <p role="alert">Không tìm thấy sự kiện.</p>;

  const ended = Date.parse(item.endTime) <= event.dataUpdatedAt;
  const kind = item.status === "PUBLISHED" ? "suspend" : "resume";

  return (
    <>
      <article className="grid overflow-hidden rounded-xl border bg-background md:grid-cols-[8rem_minmax(0,1fr)]">
        <div className="relative aspect-video overflow-hidden bg-muted md:m-3 md:self-center md:rounded-md">
          <AdminEventPoster
            event={item}
            sizes="(min-width: 768px) 128px, 95vw"
            labeled
          />
        </div>
        <div className="grid min-w-0 gap-2 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-4">
          <div className="min-w-0 space-y-2">
            <h2 className="break-words text-base font-bold leading-snug sm:text-lg">
              {item.title}
            </h2>
            <div>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {eventId}
              </p>
            </div>
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <EventControlStatus status={item.status} />
              <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
              <span>
                Kết thúc {formatDateTimeVi(item.endTime)} · Phiên bản{" "}
                {item.version}
              </span>
            </p>
          </div>
          {item.rejectionReason && (
            <p className="whitespace-pre-wrap break-words text-sm md:col-span-2">
              {item.rejectionReason}
            </p>
          )}
          {(item.status === "PUBLISHED" ||
            (item.status === "SUSPENDED" && !ended)) && (
            <Button
              className="min-h-9 rounded-full px-4"
              variant={kind === "suspend" ? "destructive" : "default"}
              disabled={mutation.isPending || event.isFetching}
              onClick={() => {
                mutation.reset();
                setResult(null);
                setConfirmation({ kind, version: item.version });
              }}
            >
              {kind === "suspend" ? (
                <ShieldAlert aria-hidden="true" />
              ) : (
                <RotateCcw aria-hidden="true" />
              )}
              {kind === "suspend" ? "Tạm dừng bán vé" : "Khôi phục mở bán"}
            </Button>
          )}
          {item.status === "SUSPENDED" && ended && (
            <p className="text-sm md:col-span-2">Sự kiện đã kết thúc.</p>
          )}
          {mutation.isError && !confirmation && (
            <p role="alert" className="text-destructive md:col-span-2">
              {mutation.error.message}
            </p>
          )}
          {result && (
            <p role="status" className="text-sm md:col-span-2">
              {result === "resumed"
                ? "Đã khôi phục mở bán."
                : `Đã đình chỉ sự kiện, hủy ${result.cancelledPendingOrdersCount} đơn chờ và giải phóng ${result.totalReleasedHoldsCount} chỗ giữ (${result.releasedHeldSeatsCount} ghế, ${result.releasedHeldStandingCount} vé đứng).`}
            </p>
          )}
        </div>
      </article>
      <EventAudit eventId={eventId} />
      {confirmation && (
        <EventConfirmation
          item={item}
          action={confirmation}
          busy={mutation.isPending}
          error={mutation.error?.message}
          onClose={() => setConfirmation(null)}
          onConfirm={(reason) => mutation.mutate({ ...confirmation, reason })}
        />
      )}
    </>
  );
}

function EventConfirmation({
  item,
  action,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  item: EventControlItem;
  action: Pick<EventAction, "kind" | "version">;
  busy: boolean;
  error: string | undefined;
  onClose: () => void;
  onConfirm: (reason?: string) => void;
}) {
  const [step, setStep] = useState<"reason" | "confirm">("reason");
  const [reason, setReason] = useState("");
  const [typedId, setTypedId] = useState("");
  const [validation, setValidation] = useState("");
  const suspend = action.kind === "suspend";
  const stale = item.version !== action.version;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogTitle>
          {suspend ? "Tạm dừng bán vé" : "Khôi phục mở bán"}
        </DialogTitle>
        <DialogDescription className="break-words">
          {item.title}.{" "}
          {suspend
            ? "Hệ thống sẽ dừng mở bán, hủy đơn chưa thanh toán và giải phóng chỗ đang giữ."
            : "Sự kiện sẽ trở lại trạng thái đã công bố."}
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (stale || busy) return;
            const dto = {
              version: action.version,
              reason: reason.trim() || undefined,
            };
            const checked = suspend
              ? EventKillSwitchRequestSchema.safeParse({
                  ...dto,
                  reason: reason.trim(),
                })
              : EventResumeRequestSchema.safeParse(dto);
            if (!checked.success) {
              setValidation(checked.error.issues[0].message);
              return;
            }
            if (suspend && step === "reason") {
              setStep("confirm");
              setValidation("");
              return;
            }
            if (suspend && typedId.trim() !== item.id) return;
            onConfirm(checked.data.reason);
          }}
        >
          {step === "reason" ? (
            <label className="grid gap-2">
              {suspend ? "Lý do đình chỉ" : "Lý do khôi phục (tùy chọn)"}
              <textarea
                autoFocus
                required={suspend}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="rounded-md border bg-background p-2"
              />
            </label>
          ) : (
            <label className="grid gap-2">
              Nhập lại mã sự kiện để xác nhận
              <code className="break-all text-xs">{item.id}</code>
              <Input
                autoFocus
                value={typedId}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setTypedId(event.target.value)}
              />
            </label>
          )}
          {(stale || validation || error) && (
            <p role="alert" className="text-destructive">
              {stale
                ? "Sự kiện đã thay đổi. Đóng hộp thoại và kiểm tra lại."
                : validation || error}
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
            <Button
              variant={
                suspend && step === "confirm" ? "destructive" : "default"
              }
              disabled={
                busy ||
                stale ||
                (step === "confirm" && typedId.trim() !== item.id)
              }
            >
              {busy
                ? "Đang xử lý..."
                : suspend && step === "reason"
                  ? "Tiếp tục"
                  : suspend
                    ? "Xác nhận đình chỉ"
                    : "Xác nhận khôi phục"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventAudit({ eventId }: { eventId: string }) {
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ["adminEventAudit", eventId, page],
    queryFn: ({ signal }) => getEventAuditLogs(eventId, page, signal),
    retry: false,
  });
  return (
    <section aria-labelledby="event-audit" className="space-y-3">
      <h2 id="event-audit" className="text-lg font-semibold">
        Nhật ký kiểm toán
      </h2>
      {audit.isPending && <p role="status">Đang tải nhật ký...</p>}
      {audit.isError && (
        <p role="alert" className="text-destructive">
          {audit.error.message}
        </p>
      )}
      {audit.data && (
        <>
          {audit.data.items.length === 0 && (
            <p>Chưa có bản ghi trên trang này.</p>
          )}
          <ol className="space-y-2">
            {audit.data.items.map((entry) => (
              <li
                key={entry.id}
                className="space-y-1 rounded-md border bg-background p-3 text-sm"
              >
                <strong>{auditLabels[entry.action] ?? entry.action}</strong>
                <p className="break-all text-muted-foreground">
                  <time dateTime={entry.createdAt}>
                    {formatDateTimeVi(entry.createdAt)}
                  </time>{" "}
                  · {entry.actorRole} · {entry.actorId ?? "Hệ thống"}
                </p>
                {typeof entry.changes?.reason === "string" && (
                  <p className="break-words">{entry.changes.reason}</p>
                )}
                {typeof entry.changes?.cancelledPendingOrdersCount ===
                  "number" && (
                  <p>
                    {entry.changes.cancelledPendingOrdersCount} đơn bị hủy ·{" "}
                    {String(entry.changes.totalReleasedHoldsCount ?? 0)} chỗ
                    được giải phóng
                  </p>
                )}
              </li>
            ))}
          </ol>
          <PageNavigation
            page={page}
            hasMore={page < audit.data.meta.totalPages}
            onChange={setPage}
          />
        </>
      )}
    </section>
  );
}
