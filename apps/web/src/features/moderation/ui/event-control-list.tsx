"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, House, Search } from "lucide-react";
import { EventControlQuerySchema } from "@tickethub/shared";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageNavigation } from "@/shared/ui/page-navigation";
import { formatDateTimeVi } from "@/shared/lib/format-vi";
import { AdminEventPoster } from "./admin-event-poster";
import { EventControlStatus } from "./event-control-status";
import { getEventControls } from "../api/event-control-api";

export function EventControlList() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [eventId, setEventId] = useState("");
  const [invalidId, setInvalidId] = useState(false);
  const router = useRouter();
  const events = useQuery({
    queryKey: ["adminEventControls", status, page],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set("status", status);
      return getEventControls(params, signal);
    },
    retry: false,
  });

  return (
    <section className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Điều khiển sự kiện
        </h1>
        <Button
          asChild
          variant="outline"
          className="min-h-10 rounded-full px-4"
        >
          <Link href="/">
            <House aria-hidden="true" />
            Trang chủ
          </Link>
        </Button>
      </header>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-background p-3">
        <label className="grid gap-1.5 text-sm">
          Trạng thái
          <select
            className="h-10 cursor-pointer rounded-lg border bg-background px-3 focus-visible:outline-2 focus-visible:outline-ring"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tất cả trạng thái</option>
            <option value="PUBLISHED">Đã công bố</option>
            <option value="SUSPENDED">Đang đình chỉ</option>
          </select>
        </label>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const result = EventControlQuerySchema.safeParse({
              eventId: eventId.trim(),
            });
            if (!result.success) {
              setInvalidId(true);
              return;
            }
            router.push(`/admin/events/${result.data.eventId}/control`);
          }}
        >
          <label className="grid gap-1.5 text-sm">
            Mã sự kiện (UUID)
            <Input
              className="h-10 sm:w-80"
              placeholder="Dán mã sự kiện"
              value={eventId}
              required
              aria-invalid={invalidId}
              onChange={(event) => {
                setEventId(event.target.value);
                setInvalidId(false);
              }}
            />
          </label>
          <Button className="min-h-10 rounded-full px-4">
            <Search aria-hidden="true" />
            Mở sự kiện
          </Button>
        </form>
      </div>
      {invalidId && (
        <p role="alert" className="text-sm text-destructive">
          Mã sự kiện không hợp lệ.
        </p>
      )}
      {events.isPending && <p role="status">Đang tải sự kiện...</p>}
      {events.isError && (
        <p role="alert" className="text-destructive">
          {events.error.message}
        </p>
      )}
      {events.data && (
        <>
          {events.data.items.length > 0 ? (
            <div className="overflow-hidden rounded-xl border bg-background">
              <table className="w-full text-xs">
                <thead className="bg-muted text-muted-foreground">
                  <tr className="text-left [&>th]:h-8 [&>th]:px-3 [&>th]:font-semibold">
                    <th>Sự kiện</th>
                    <th className="hidden w-44 sm:table-cell">Kết thúc</th>
                    <th className="w-36">Trạng thái</th>
                    <th className="w-28 text-right">
                      <span className="sr-only">Thao tác</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.data.items.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-border/60 bg-background last:border-b-0 hover:bg-secondary/50 [&>td]:px-3 [&>td]:py-1.5"
                    >
                      <td className="max-w-0">
                        <Link
                          href={`/admin/events/${event.id}/control`}
                          prefetch={false}
                          className="group flex items-center gap-3 rounded-md py-1 focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <span className="relative aspect-video w-12 shrink-0 overflow-hidden rounded-md bg-muted sm:w-16">
                            <AdminEventPoster event={event} sizes="64px" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-foreground">
                              {event.title}
                            </span>
                            <span className="block truncate text-muted-foreground sm:hidden">
                              Kết thúc {formatDateTimeVi(event.endTime)}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="hidden font-mono tabular-nums text-muted-foreground sm:table-cell">
                        {formatDateTimeVi(event.endTime)}
                      </td>
                      <td className="whitespace-nowrap">
                        <EventControlStatus status={event.status} />
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/admin/events/${event.id}/control`}
                          prefetch={false}
                          className="inline-flex items-center gap-1 font-semibold text-primary focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          Mở
                          <ArrowRight aria-hidden="true" className="size-3.5" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed bg-background p-8 text-center text-muted-foreground">
              Không có sự kiện phù hợp.
            </p>
          )}
          {(page > 1 || events.data.hasMore) && (
            <PageNavigation
              page={page}
              hasMore={events.data.hasMore}
              onChange={setPage}
            />
          )}
        </>
      )}
    </section>
  );
}
