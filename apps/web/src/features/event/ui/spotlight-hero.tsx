"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatVnd } from "@/shared/lib/format";
import { type EventItem } from "../domain/event.types";

const ROTATE_MS = 6000;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// Anh ro net o ben phai, chi mo dan ve phia chu de van doc duoc
const FADE_MASK = "linear-gradient(to right, transparent 0%, #000 34%)";

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(REDUCED_MOTION);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

export function SpotlightHero({ events }: { events: EventItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const count = events.length;

  useEffect(() => {
    if (paused || reducedMotion || count < 2) return;
    const timer = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [paused, reducedMotion, count]);

  if (count === 0) return null;

  const active = events[index % count];

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Sự kiện nổi bật"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative overflow-hidden bg-surface-dark text-white"
    >
      {/* Anh su kien: chiem phan lon hero, khong bi che boi lop phu */}
      <div
        key={active.id}
        className={`absolute inset-y-0 right-0 w-full md:w-[72%] ${index === 0 ? "" : "animate-in fade-in duration-700"}`}
        style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
      >
        <Image
          src={active.image}
          alt={`Poster ${active.title}`}
          fill
          fetchPriority={index === 0 ? "high" : "auto"}
          loading="eager"
          quality={60}
          sizes="(max-width: 768px) 100vw, 72vw"
          className="object-cover object-[center_30%]"
        />
      </div>
      {/* Chi lam toi phan day de chu ro tren man hinh nho */}
      <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-surface-dark/90 to-transparent md:hidden" />

      <div className="relative max-w-[1200px] mx-auto px-4 sm:px-6 pt-28 pb-10 sm:pb-12 min-h-[560px] flex flex-col justify-end">
        <div className="max-w-md" aria-live={paused ? "polite" : "off"}>
          <span className="inline-flex h-6 items-center rounded-full bg-white/15 px-3 text-xs font-bold backdrop-blur-sm">
            Nổi bật
          </span>
          <h2 className="mt-3 text-3xl sm:text-[44px] font-extrabold leading-[1.1] tracking-tight [text-shadow:0_2px_12px_rgba(0,0,0,0.45)]">
            {active.title}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-200 [text-shadow:0_1px_8px_rgba(0,0,0,0.5)]">
            {active.dateRange}
            <span className="mx-2 text-slate-400">|</span>
            {active.venue}, {active.city}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Link
              href={`/events/${active.id}`}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-7 text-sm font-bold text-white hover:bg-emerald-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-surface-dark"
            >
              Xem sự kiện <ArrowRight className="size-4" />
            </Link>
            <p className="text-sm text-slate-200">
              Từ{" "}
              <strong className="text-lg text-white">
                {formatVnd(active.minPriceNumber)}
              </strong>
            </p>
          </div>

          {count > 1 && (
            <div
              role="group"
              aria-label="Chọn sự kiện nổi bật"
              className="-mx-1.5 mt-6 flex gap-2 overflow-x-auto p-1.5"
            >
              {events.map((ev, i) => {
                const isActive = i === index % count;
                return (
                  <button
                    key={ev.id}
                    type="button"
                    aria-label={ev.title}
                    aria-current={isActive}
                    onClick={() => setIndex(i)}
                    className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                      isActive
                        ? "opacity-100 outline outline-2 outline-offset-2 outline-emerald-400"
                        : "opacity-60 hover:opacity-100"
                    }`}
                  >
                    <Image
                      src={ev.image}
                      alt=""
                      fill
                      sizes="80px"
                      fetchPriority="low"
                      className="object-cover"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
