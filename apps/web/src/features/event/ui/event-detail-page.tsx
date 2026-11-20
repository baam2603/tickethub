import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CalendarDays,
  Clock,
  MapPin,
  Building2,
  ShieldCheck,
  Timer,
  Ticket,
  ArrowLeft,
} from "lucide-react";
import { getEventById } from "../api/event-catalog";
import { getEventListings } from "../data/event-listings";
import { formatVnd } from "@/shared/lib/format";
import { type EventItem } from "../domain/event.types";

const CATEGORY_LABEL: Record<string, string> = {
  CONCERT: "Ca nhạc",
  SPORT: "Thể thao",
  THEATER: "Sân khấu",
};

type ZoneSummary = {
  name: string;
  minPrice: number;
  available: number;
  standing: boolean;
};

function summarizeZones(event: EventItem): ZoneSummary[] {
  const byZone = new Map<string, ZoneSummary>();
  for (const l of getEventListings(event)) {
    const cur = byZone.get(l.zoneName);
    if (!cur) {
      byZone.set(l.zoneName, {
        name: l.zoneName,
        minPrice: l.price,
        available: l.availableTickets,
        standing: Boolean(l.isStanding),
      });
    } else {
      cur.minPrice = Math.min(cur.minPrice, l.price);
      cur.available += l.availableTickets;
    }
  }
  return [...byZone.values()].sort((a, b) => b.minPrice - a.minPrice);
}

function availability(available: number) {
  if (available <= 0)
    return { label: "Hết vé", cls: "bg-slate-100 text-slate-600" };
  if (available <= 10)
    return { label: "Sắp hết", cls: "bg-amber-50 text-amber-700" };
  return { label: "Còn vé", cls: "bg-emerald-50 text-emerald-700" };
}

/** Trang gioi thieu su kien (landing page SEO), render phia may chu. */
export async function EventDetailPage({ id }: { id: string }) {
  const event = getEventById(id);
  if (!event) notFound();

  const zones = summarizeZones(event);
  const bookingHref = `/events/${event.id}/booking`;
  const mapSrc = `https://maps.google.com/maps?q=${encodeURIComponent(
    `${event.venue}, ${event.venueAddress}`,
  )}&output=embed`;

  return (
    <article className="pb-10">
      {/* Hero */}
      <section className="relative bg-surface-dark text-white overflow-hidden">
        <Image
          src={event.image}
          alt=""
          fill
          sizes="320px"
          className="object-cover opacity-30 blur-sm scale-105"
        />
        <div className="relative max-w-[1200px] mx-auto px-4 sm:px-6 pt-24 pb-8 sm:pt-28 sm:pb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white mb-5"
          >
            <ArrowLeft className="size-3.5" /> Khám phá sự kiện
          </Link>
          <div className="grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-white/10 shadow-xl">
              <Image
                src={event.image}
                alt={`Poster ${event.title}`}
                fill
                fetchPriority="high"
                loading="eager"
                sizes="(max-width: 768px) 100vw, 45vw"
                className="object-cover"
              />
            </div>
            <div className="space-y-4">
              <span className="inline-flex h-6 items-center rounded-full bg-white/15 px-3 text-xs font-semibold">
                {CATEGORY_LABEL[event.category] ?? event.category}
              </span>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
                {event.title}
              </h1>
              <ul className="space-y-2 text-sm text-white/90">
                <li className="flex items-start gap-2.5">
                  <CalendarDays className="size-4 mt-0.5 shrink-0" />
                  <span>{event.fullDateTime}</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <MapPin className="size-4 mt-0.5 shrink-0" />
                  <span>
                    {event.venue}, {event.city}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-10 min-w-0">
          {/* About */}
          <section aria-labelledby="about">
            <h2 id="about" className="text-xl font-bold mb-3">
              Giới thiệu sự kiện
            </h2>
            <p className="text-[15px] leading-relaxed text-foreground">
              {event.description}
            </p>
            <dl className="mt-5 grid sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-xl border border-border p-4">
                <dt className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <CalendarDays className="size-3.5" /> Thời gian
                </dt>
                <dd className="mt-1 font-semibold">{event.fullDateTime}</dd>
              </div>
              <div className="rounded-xl border border-border p-4">
                <dt className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Clock className="size-3.5" /> Mở cửa
                </dt>
                <dd className="mt-1 font-semibold">{event.doorsOpenTime}</dd>
              </div>
              <div className="rounded-xl border border-border p-4">
                <dt className="flex items-center gap-1.5 text-muted-foreground text-xs">
                  <Building2 className="size-3.5" /> Ban tổ chức
                </dt>
                <dd className="mt-1 font-semibold">{event.organizerName}</dd>
              </div>
            </dl>
          </section>

          {/* Ticket classes */}
          <section aria-labelledby="tickets">
            <h2 id="tickets" className="text-xl font-bold mb-1">
              Các hạng vé
            </h2>
            <p className="text-sm text-muted-foreground mb-3">
              Bạn chọn khu vực và số lượng, hệ thống tự động xếp chỗ ngồi cho
              bạn.
            </p>
            <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">
              {zones.map((z) => {
                const a = availability(z.available);
                return (
                  <div
                    key={z.name}
                    className="flex items-center gap-3 px-4 py-3 text-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{z.name}</p>
                      {z.standing && (
                        <p className="text-xs text-muted-foreground">Vé đứng</p>
                      )}
                    </div>
                    <span
                      className={`inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium ${a.cls}`}
                    >
                      {a.label}
                    </span>
                    <p className="w-32 text-right font-bold tabular-nums">
                      {formatVnd(z.minPrice)}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Venue */}
          <section aria-labelledby="venue">
            <h2 id="venue" className="text-xl font-bold mb-3">
              Địa điểm
            </h2>
            <p className="font-semibold">{event.venue}</p>
            <p className="text-sm text-muted-foreground mb-3">
              {event.venueAddress}
            </p>
            <iframe
              title={`Bản đồ ${event.venue}`}
              src={mapSrc}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-72 rounded-xl border border-border"
            />
          </section>

          {/* Terms */}
          <section aria-labelledby="terms">
            <h2 id="terms" className="text-xl font-bold mb-3">
              Điều khoản và lưu ý
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground">
              <li>Mỗi giao dịch mua tối đa 6 vé.</li>
              <li>
                Chỗ ngồi được hệ thống phân bổ tự động, ưu tiên các ghế liền kề
                nhau trong cùng một hàng.
              </li>
              <li>
                Chỗ được giữ trong 5 phút kể từ khi bạn bắt đầu thanh toán. Hết
                thời gian, chỗ sẽ được trả lại cho người khác.
              </li>
              <li>
                Vé điện tử dùng mã QR đổi mỗi 30 giây, không dùng ảnh chụp màn
                hình hoặc bản in.
              </li>
              <li>
                Chính sách hủy và hoàn vé do Ban tổ chức quy định cho từng sự
                kiện. Sự kiện bị hủy sẽ được hoàn tiền đầy đủ.{" "}
                <Link
                  href="/faq?tab=refund"
                  className="text-primary font-semibold hover:underline"
                >
                  Xem chính sách hoàn vé
                </Link>
                .
              </li>
            </ul>
          </section>
        </div>

        {/* Sticky buy card */}
        <aside className="order-first lg:order-none lg:sticky lg:top-24 h-fit rounded-2xl border border-border bg-white p-5 space-y-4 shadow-sm">
          <div>
            <p className="text-xs text-muted-foreground">Giá vé từ</p>
            <p className="text-2xl font-extrabold">
              {formatVnd(event.minPriceNumber)}
            </p>
          </div>
          <Link
            href={bookingHref}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-white hover:bg-emerald-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Ticket className="size-4" /> Mua vé ngay
          </Link>
          <ul className="space-y-2 text-xs text-foreground">
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary shrink-0" /> Vé chính
              thức 100% từ Ban tổ chức
            </li>
            <li className="flex items-center gap-2">
              <Timer className="size-4 text-primary shrink-0" /> Giữ chỗ riêng 5
              phút khi thanh toán
            </li>
          </ul>
        </aside>
      </div>
    </article>
  );
}
