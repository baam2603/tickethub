"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { AdminEventPoster } from "./admin-event-poster";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search, X } from "lucide-react";
import {
  getAdminOrganizers,
  getAdminPendingEvents,
  reviewAdminEvent,
  reviewOrganizerProfile,
} from "../api/moderation-api";
import { formatDateTimeVi } from "@/shared/lib/format-vi";
import type {
  AdminPendingEvent,
  AdminPendingOrganizer,
  ReviewDecision,
} from "../domain/moderation.types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/shared/ui/dialog";

// Ham an thong tin ca nhan (Decree 13/2023/ND-CP)
function maskIdentifier(val?: string): string {
  if (!val) return "";
  if (val.length <= 4) return val;
  return "*".repeat(val.length - 4) + val.slice(-4);
}

function maskEmail(email?: string): string {
  if (!email || !email.includes("@")) return email || "";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `*@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

const BADGE_BASE =
  "inline-flex items-center h-5 px-1.5 rounded border text-[11px] font-medium whitespace-nowrap";
const BADGE_PENDING = "bg-amber-500/10 text-amber-700 border-amber-500/20";

type QueueRow = {
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  statusLabel: string;
  badgeClass: string;
  pending: boolean;
  event?: AdminPendingEvent;
  searchText: string;
};

export function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-xs text-muted-foreground">Đang tải...</div>
      }
    >
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const view =
    useSearchParams().get("view") === "events" ? "events" : "organizers";
  return (
    <>
      <nav
        aria-label="Hàng đợi kiểm duyệt"
        className="flex flex-wrap gap-2 border-b bg-background px-4 py-3 text-sm"
      >
        <Link
          href="/admin/moderation"
          aria-current={view === "organizers" ? "page" : undefined}
          className="rounded-full border border-transparent px-4 py-2 font-medium text-muted-foreground transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:border-primary/20 aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
        >
          Hồ sơ ban tổ chức
        </Link>
        <Link
          href="/admin/moderation?view=events"
          aria-current={view === "events" ? "page" : undefined}
          className="rounded-full border border-transparent px-4 py-2 font-medium text-muted-foreground transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:border-primary/20 aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
        >
          Sự kiện chờ duyệt
        </Link>
      </nav>
      <QueueView key={view} kind={view} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Queue (organizer profiles / pending events) with detail side panel   */
/* ------------------------------------------------------------------ */

function QueueView({ kind }: { kind: "organizers" | "events" }) {
  const queryClient = useQueryClient();
  const isOrg = kind === "organizers";

  const {
    data: organizers,
    isLoading: loadingOrgs,
    error: organizerError,
  } = useQuery({
    queryKey: ["adminOrganizers"],
    queryFn: getAdminOrganizers,
    enabled: isOrg,
  });
  const {
    data: events,
    isLoading: loadingEvents,
    error: eventError,
  } = useQuery({
    queryKey: ["adminPendingEvents"],
    queryFn: getAdminPendingEvents,
    enabled: !isOrg,
  });
  const loading = isOrg ? loadingOrgs : loadingEvents;
  const error = isOrg ? organizerError : eventError;

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: "APPROVE" | "REJECT";
    reason?: string;
  } | null>(null);
  const [lastIndex, setLastIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async (d: ReviewDecision) => {
      if (isOrg) await reviewOrganizerProfile(d);
      else await reviewAdminEvent(d);
    },
    onSuccess: async (_, decision) => {
      setRejectFor(null);
      setConfirm(null);
      const updates = [
        queryClient.invalidateQueries({
          queryKey: isOrg ? ["adminOrganizers"] : ["adminPendingEvents"],
        }),
      ];
      if (!isOrg) {
        updates.push(
          queryClient.invalidateQueries({ queryKey: ["adminEventControls"] }),
          queryClient.invalidateQueries({
            queryKey: ["adminEventControl", decision.id],
          }),
          queryClient.invalidateQueries({
            queryKey: ["adminEventAudit", decision.id],
          }),
        );
      }
      await Promise.all(updates);
    },
  });

  const rows: QueueRow[] = useMemo(() => {
    if (isOrg) {
      return (organizers ?? []).map((org) => ({
        id: org.id,
        title: org.organizationName,
        subtitle: org.representativeName,
        meta: maskIdentifier(org.taxCode),
        statusLabel: "Chờ xác minh",
        badgeClass: BADGE_PENDING,
        pending: true,
        searchText:
          `${org.organizationName} ${org.representativeName} ${org.taxCode}`.toLowerCase(),
      }));
    }
    return (events ?? []).map((event) => ({
      id: event.id,
      title: event.title,
      event,
      subtitle: event.organizationName,
      meta: formatDateTimeVi(event.startTime),
      statusLabel: "Chờ duyệt",
      badgeClass: BADGE_PENDING,
      pending: true,
      searchText: `${event.title} ${event.organizationName}`.toLowerCase(),
    }));
  }, [isOrg, organizers, events]);

  const pendingCount = rows.filter((r) => r.pending).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => row.searchText.includes(q));
  }, [rows, query]);

  // Giu vi tri chon: neu muc dang chon bien mat (da duyet), chon muc ke tiep
  const found = visible.findIndex((r) => r.id === selectedId);
  const selectedIndex =
    found >= 0 ? found : Math.min(lastIndex, visible.length - 1);
  const selected = visible[selectedIndex] ?? null;

  const rawOrg = isOrg ? organizers?.find((o) => o.id === selected?.id) : null;
  const rawEvent = !isOrg ? events?.find((e) => e.id === selected?.id) : null;

  const version = rawOrg?.version ?? rawEvent?.version;

  const approve = useCallback(() => {
    if (!selected?.pending || version === undefined || mutation.isPending)
      return;
    mutation.reset();
    setConfirm({ kind: "APPROVE" });
  }, [selected, mutation, version]);

  const submitConfirmed = () => {
    if (!selected || version === undefined || !confirm || mutation.isPending)
      return;
    mutation.mutate(
      confirm.kind === "APPROVE"
        ? { id: selected.id, decision: "APPROVE", version }
        : {
            id: selected.id,
            decision: "REJECT",
            reason: confirm.reason,
            version,
          },
    );
  };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (
        confirm ||
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return;
      }
      const move = (delta: number) => {
        if (visible.length === 0) return;
        const next = Math.max(
          0,
          Math.min(visible.length - 1, selectedIndex + delta),
        );
        setLastIndex(next);
        setSelectedId(visible[next].id);
        setRejectFor(null);
      };
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "a") {
        approve();
      } else if (e.key === "r" && selected?.pending) {
        e.preventDefault();
        setRejectFor(selected.id);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedIndex, selected, approve, confirm]);

  const mutationError =
    mutation.isError && mutation.variables?.id === selected?.id
      ? mutation.error.message || "Thao tác thất bại. Vui lòng thử lại."
      : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Toolbar
        title={isOrg ? "Hồ sơ Ban tổ chức" : "Sự kiện chờ duyệt"}
        count={`${pendingCount} chờ duyệt`}
        query={query}
        onQuery={setQuery}
        searchRef={searchRef}
        placeholder={
          isOrg ? "Tìm tên đơn vị, MST..." : "Tìm sự kiện, ban tổ chức..."
        }
      />
      {error && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error.message}
        </p>
      )}
      <div className="flex flex-1 flex-col md:min-h-0 lg:flex-row">
        {/* Danh sach */}
        <div className="flex-1 min-w-0 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr className="text-left [&>th]:h-8 [&>th]:px-3 [&>th]:font-semibold">
                <th>{isOrg ? "Đơn vị / Đại diện" : "Sự kiện / Ban tổ chức"}</th>
                <th className="w-44">{isOrg ? "MST / CCCD" : "Bắt đầu"}</th>
                <th className="w-28">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const active = r.id === selected?.id;
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-border/60 [&>td]:px-3 [&>td]:py-1.5 ${
                      active
                        ? "bg-primary/5 shadow-[inset_2px_0_0_var(--primary)]"
                        : "bg-background hover:bg-secondary/50"
                    }`}
                  >
                    <td className="max-w-0">
                      <button
                        type="button"
                        aria-pressed={active}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => {
                          setSelectedId(r.id);
                          setLastIndex(visible.indexOf(r));
                          setRejectFor(null);
                        }}
                      >
                        {r.event && (
                          <span className="relative aspect-video w-14 shrink-0 overflow-hidden rounded-md bg-muted sm:w-20">
                            <AdminEventPoster event={r.event} sizes="80px" />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-foreground">
                            {r.title}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {r.subtitle}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="font-mono tabular-nums text-muted-foreground">
                      {r.meta}
                    </td>
                    <td>
                      <span className={`${BADGE_BASE} ${r.badgeClass}`}>
                        {r.statusLabel}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && !error && visible.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {!query
                ? "Hàng đợi trống. Không có mục nào cần xử lý."
                : "Không có kết quả phù hợp."}
            </p>
          )}
          {loading && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Đang tải...
            </p>
          )}
        </div>

        {/* Chi tiet */}
        <aside className="shrink-0 border-t border-border bg-background lg:w-96 lg:border-t-0 lg:border-l lg:overflow-y-auto">
          {selected ? (
            <DetailPanel
              key={selected.id}
              row={selected}
              org={rawOrg ?? null}
              event={rawEvent ?? null}
              rejecting={rejectFor === selected.id}
              busy={mutation.isPending}
              error={mutationError}
              onApprove={approve}
              onStartReject={() => setRejectFor(selected.id)}
              onCancelReject={() => setRejectFor(null)}
              onReject={(reason) => {
                mutation.reset();
                setConfirm({ kind: "REJECT", reason });
              }}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">
              Chọn một mục trong danh sách để xem chi tiết.
            </p>
          )}
        </aside>
      </div>

      <footer className="hidden md:flex h-7 shrink-0 border-t border-border bg-background px-3 items-center gap-4 text-[11px] text-muted-foreground">
        <span>
          <Kbd>j</Kbd> <Kbd>k</Kbd> di chuyển
        </span>
        <span>
          <Kbd>a</Kbd> duyệt
        </span>
        <span>
          <Kbd>r</Kbd> từ chối
        </span>
        <span>
          <Kbd>/</Kbd> tìm kiếm
        </span>
      </footer>
      {confirm && selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !mutation.isPending) setConfirm(null);
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogTitle>
              {confirm.kind === "APPROVE"
                ? isOrg
                  ? "Xác nhận phê duyệt hồ sơ"
                  : "Xác nhận duyệt mở bán"
                : "Xác nhận từ chối"}
            </DialogTitle>
            <DialogDescription className="break-words">
              {selected.title}.{" "}
              {confirm.kind === "APPROVE"
                ? isOrg
                  ? "Ban tổ chức sẽ được cấp quyền tạo sự kiện."
                  : "Sự kiện sẽ được công bố và mở bán ngay."
                : "Ban tổ chức sẽ nhận được lý do từ chối bên dưới."}
            </DialogDescription>
            {confirm.kind === "REJECT" && (
              <p className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">
                {confirm.reason}
              </p>
            )}
            {mutationError && (
              <p role="alert" className="text-sm text-destructive">
                {mutationError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => setConfirm(null)}
              >
                Hủy
              </Button>
              <Button
                type="button"
                autoFocus
                variant={confirm.kind === "REJECT" ? "destructive" : "default"}
                disabled={mutation.isPending}
                onClick={submitConfirmed}
              >
                {mutation.isPending
                  ? "Đang xử lý..."
                  : confirm.kind === "APPROVE"
                    ? "Xác nhận duyệt"
                    : "Xác nhận từ chối"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DetailPanel({
  row,
  org,
  event,
  rejecting,
  busy,
  error,
  onApprove,
  onStartReject,
  onCancelReject,
  onReject,
}: {
  row: QueueRow;
  org: AdminPendingOrganizer | null;
  event: AdminPendingEvent | null;
  rejecting: boolean;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onStartReject: () => void;
  onCancelReject: () => void;
  onReject: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const fields: [string, string][] = org
    ? [
        ["Đại diện pháp luật", org.representativeName],
        ["MST", maskIdentifier(org.taxCode)],
        ["Email", maskEmail(org.email)],
        ["Ngày gửi", formatDateTimeVi(org.createdAt)],
        ["Phiên bản", String(org.version)],
      ]
    : event
      ? [
          ["Ban tổ chức", event.organizationName],
          ["Bắt đầu", formatDateTimeVi(event.startTime)],
          ["Phiên bản", String(event.version)],
        ]
      : [];
  const licenseUrl = org?.businessLicenseUrl;
  const licenseLink =
    licenseUrl && /^https?:\/\//i.test(licenseUrl) ? licenseUrl : null;

  return (
    <div className="flex flex-col min-h-full">
      {event && (
        <div className="relative aspect-video overflow-hidden bg-muted">
          <AdminEventPoster
            event={event}
            sizes="(min-width: 1024px) 384px, 100vw"
            labeled
          />
        </div>
      )}
      <div className="p-4 border-b border-border">
        <span className={`${BADGE_BASE} ${row.badgeClass}`}>
          {row.statusLabel}
        </span>
        <h2 className="mt-2 text-base font-bold leading-snug">{row.title}</h2>
        {licenseLink && (
          <a
            href={licenseLink}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-sm underline"
          >
            Giấy phép kinh doanh
          </a>
        )}
      </div>

      <dl className="p-4 grid grid-cols-[110px_1fr] gap-y-2 text-xs flex-1 content-start">
        {fields.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium break-words">{v}</dd>
          </div>
        ))}
        {org?.businessLicenseUrl && (
          <>
            <dt className="text-muted-foreground">Giấy phép KD</dt>
            <dd>
              <a
                href={org.businessLicenseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline font-medium"
              >
                Mở tệp đính kèm
              </a>
            </dd>
          </>
        )}
      </dl>

      {row.pending && (
        <div className="sticky bottom-0 border-t border-border bg-background p-3 space-y-2">
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {rejecting ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!reason.trim()) {
                  setReasonError(true);
                  return;
                }
                onReject(reason.trim());
              }}
            >
              <Input
                autoFocus
                value={reason}
                aria-invalid={reasonError}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onCancelReject();
                }}
                placeholder="Lý do từ chối (bắt buộc, gửi cho BTC)"
                className="h-8 text-xs"
              />
              {reasonError && (
                <p className="text-xs text-destructive">
                  Vui lòng nhập lý do từ chối.
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="destructive"
                  className="flex-1"
                  disabled={busy}
                >
                  {busy ? "Đang xử lý..." : "Tiếp tục"}
                </Button>
                <Button type="button" variant="ghost" onClick={onCancelReject}>
                  Hủy
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy} onClick={onApprove}>
                <Check /> {event ? "Duyệt mở bán" : "Phê duyệt"}
                <Kbd tone="onPrimary">a</Kbd>
              </Button>
              <Button variant="outline" disabled={busy} onClick={onStartReject}>
                <X /> Từ chối <Kbd>r</Kbd>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Toolbar({
  title,
  count,
  query,
  onQuery,
  searchRef,
  placeholder,
  children,
}: {
  title: string;
  count: string;
  query: string;
  onQuery: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-12 shrink-0 border-b border-border bg-background p-3 flex flex-wrap items-center gap-3">
      <h1 className="text-sm font-bold">{title}</h1>
      <span className="text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
      <div className="flex-1" />
      {children}
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onQuery("");
              e.currentTarget.blur();
            }
          }}
          placeholder={placeholder}
          aria-label="Tìm kiếm"
          className="h-7 pl-7 text-xs"
        />
      </div>
    </div>
  );
}

function Kbd({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "onPrimary";
}) {
  return (
    <kbd
      className={`inline-flex items-center justify-center min-w-4 h-4 px-1 rounded border text-[10px] font-mono ${
        tone === "onPrimary"
          ? "border-white/30 bg-white/10 text-white"
          : "border-border bg-secondary text-muted-foreground"
      }`}
    >
      {children}
    </kbd>
  );
}
