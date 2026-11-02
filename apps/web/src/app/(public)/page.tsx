"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Search,
  MapPin,
  Calendar,
  ChevronDown,
  Navigation,
  X,
} from "lucide-react";
import {
  EVENTS,
  type CategoryCode,
  type EventItem,
} from "@/lib/events-catalog";

const POPULAR_CATEGORIES = [
  {
    title: "Hòa nhạc",
    category: "CONCERT" as CategoryCode,
    image: "/images/events/cat-concerts.jpeg",
  },
  {
    title: "Bóng đá & V.League",
    category: "SPORT" as CategoryCode,
    image: "/images/events/cat-soccer.jpeg",
  },
  {
    title: "Nhạc kịch & Sân khấu",
    category: "THEATER" as CategoryCode,
    image: "/images/events/cat-theater.jpeg",
  },
  {
    title: "Bóng rổ VBA",
    category: "SPORT" as CategoryCode,
    image: "/images/events/cat-basketball.jpeg",
  },
];

/**
 * Translucent favorite heart icon with subtle dark fill and white outline
 */
function FavoriteHeartIcon({ isSaved }: { isSaved: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="transition-transform duration-150 hover:scale-110"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="m8.869 4.893.754.867a.5.5 0 0 0 .754 0l.754-.867c.46-.528 1.944-1.932 3.992-1.16A3.616 3.616 0 0 1 17.1 8.789c-.948 1.874-2.965 4.466-7.101 7.39-4.136-2.924-6.154-5.517-7.101-7.39a3.617 3.617 0 0 1 1.979-5.055c2.047-.772 3.53.632 3.99 1.16"
        fill={isSaved ? "#059669" : "#000"}
        fillOpacity={isSaved ? 1 : 0.38}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.348 2.33C1.383 3.447.202 6.778 1.56 9.465 2.714 11.745 5.14 14.737 10 18c4.86-3.264 7.286-6.255 8.44-8.535 1.358-2.687.177-6.018-2.788-7.135-1.947-.735-3.52-.11-4.53.584A6 6 0 0 0 10 3.908a6 6 0 0 0-1.123-.994c-1.01-.694-2.582-1.319-4.529-.584m4.52 2.563.755.867a.5.5 0 0 0 .754 0l.754-.867c.46-.528 1.944-1.932 3.992-1.16A3.616 3.616 0 0 1 17.1 8.789c-.948 1.874-2.965 4.466-7.101 7.39-4.136-2.924-6.154-5.517-7.101-7.39a3.617 3.617 0 0 1 1.979-5.055c2.048-.772 3.53.632 3.99 1.16"
        fill="#fff"
      />
    </svg>
  );
}

/**
 * Standard 5:4 landscape event card with title, date range, and starting price
 */
function EventGridCard({
  event,
  isSaved,
  onToggleSave,
}: {
  event: EventItem;
  isSaved: boolean;
  onToggleSave: (id: string) => void;
}) {
  return (
    <div className="group relative flex flex-col">
      <div className="relative aspect-[5/4] w-full overflow-hidden rounded-[16px] bg-[#eff1f2]">
        <Link href={`/events/${event.id}`} className="block h-full w-full">
          <Image
            src={event.image}
            alt={event.title}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        </Link>

        <button
          type="button"
          onClick={() => onToggleSave(event.id)}
          aria-label={isSaved ? "Bỏ lưu" : "Lưu vào yêu thích"}
          className="absolute top-3 right-3 p-1"
        >
          <FavoriteHeartIcon isSaved={isSaved} />
        </button>
      </div>

      <Link href={`/events/${event.id}`} className="pt-2 flex flex-col">
        <h3 className="text-[14px] font-bold leading-[1.35] text-[#141d23] truncate group-hover:text-primary transition-colors">
          {event.title}
        </h3>
        <p className="text-[12px] leading-[1.4] text-[#606970] truncate">
          {event.dateRange}
        </p>
        <p className="text-[14px] font-bold leading-[1.4] text-[#141d23] pt-0.5">
          {event.fromPrice}
        </p>
      </Link>
    </div>
  );
}

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryCode>("ALL");
  const [selectedCity, setSelectedCity] = useState<"ALL" | "HCM" | "HN" | "DN">(
    "HCM",
  );
  const [selectedDate, setSelectedDate] = useState<
    "ALL" | "WEEKEND" | "NOV" | "DEC"
  >("ALL");

  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [alertSubscribed, setAlertSubscribed] = useState(false);

  const toggleSave = (id: string) => {
    setSavedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const cycleCity = () => {
    const order: Array<"HCM" | "HN" | "DN" | "ALL"> = [
      "HCM",
      "HN",
      "DN",
      "ALL",
    ];
    const next = order[(order.indexOf(selectedCity) + 1) % order.length];
    setSelectedCity(next);
  };

  const cycleDate = () => {
    const order: Array<"ALL" | "WEEKEND" | "NOV" | "DEC"> = [
      "ALL",
      "WEEKEND",
      "NOV",
      "DEC",
    ];
    const next = order[(order.indexOf(selectedDate) + 1) % order.length];
    setSelectedDate(next);
  };

  const cityButtonLabel =
    selectedCity === "HCM"
      ? "TP. Hồ Chí Minh"
      : selectedCity === "HN"
        ? "Hà Nội"
        : selectedCity === "DN"
          ? "Đà Nẵng"
          : "Toàn quốc";

  const dateButtonLabel =
    selectedDate === "ALL"
      ? "Tất cả ngày"
      : selectedDate === "WEEKEND"
        ? "Cuối tuần này"
        : selectedDate === "NOV"
          ? "Tháng 11"
          : "Tháng 12";

  // Top 4 Popular Marquee Portrait Cards
  const popularMarqueeEvents = useMemo(() => {
    return EVENTS.filter((e) => e.featuredOrder).sort(
      (a, b) => (a.featuredOrder ?? 99) - (b.featuredOrder ?? 99),
    );
  }, []);

  // Filtered pool for carousels below the filter bar
  const filteredPool = useMemo(() => {
    return EVENTS.filter((ev) => {
      if (selectedCategory !== "ALL" && ev.category !== selectedCategory) {
        return false;
      }
      if (selectedDate !== "ALL" && ev.dateWindow !== selectedDate) {
        return false;
      }
      if (searchQuery.trim() !== "") {
        const q = searchQuery.toLowerCase();
        return (
          ev.title.toLowerCase().includes(q) ||
          ev.venue.toLowerCase().includes(q) ||
          ev.city.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [selectedCategory, selectedDate, searchQuery]);

  const trendingEvents = useMemo(() => {
    const list = filteredPool.filter((e) => e.trendingOrder);
    return (list.length > 0 ? list : filteredPool).slice(0, 4);
  }, [filteredPool]);

  const concertEvents = useMemo(() => {
    return filteredPool
      .filter(
        (e) =>
          (e.category === "CONCERT" || e.category === "FESTIVAL") &&
          !e.featuredOrder &&
          !e.trendingOrder,
      )
      .slice(0, 4);
  }, [filteredPool]);

  const sportEvents = useMemo(() => {
    return filteredPool.filter((e) => e.category === "SPORT").slice(0, 4);
  }, [filteredPool]);

  const theaterEvents = useMemo(() => {
    return filteredPool.filter((e) => e.category === "THEATER").slice(0, 4);
  }, [filteredPool]);

  return (
    <div className="bg-white">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        {/* 1. Centered Floating Pill Search Bar on Pure White Background */}
        <div className="pt-2 pb-8">
          <div className="max-w-[760px] mx-auto">
            <div className="relative flex items-center bg-white rounded-full h-[50px] px-5 border border-[#e2e6e8] shadow-[0_4px_16px_rgba(0,0,0,0.08)] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all">
              <Search className="size-4.5 text-primary shrink-0 mr-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm sự kiện, nghệ sĩ, đội bóng và địa điểm"
                aria-label="Tìm sự kiện, nghệ sĩ, đội bóng và địa điểm"
                className="w-full bg-transparent text-[14px] text-[#141d23] placeholder:text-[#606970] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Xóa tìm kiếm"
                  className="p-1 text-[#606970] hover:text-[#141d23]"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 2. Featured Events Portrait Row */}
        <section aria-labelledby="heading-popular" className="pb-6">
          <h2
            id="heading-popular"
            className="text-[19px] font-bold tracking-[-0.01em] text-[#141d23] mb-4"
          >
            Sự kiện nổi bật
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {popularMarqueeEvents.map((ev) => {
              const isSaved = savedIds.includes(ev.id);
              return (
                <div
                  key={ev.id}
                  className="group relative aspect-[286/352] w-full overflow-hidden rounded-[16px] bg-[#141d23]"
                >
                  <Link
                    href={`/events/${ev.id}`}
                    className="block h-full w-full"
                  >
                    <Image
                      src={ev.portraitImage || ev.image}
                      alt={ev.title}
                      fill
                      unoptimized
                      priority
                      sizes="(max-width: 640px) 100vw, 25vw"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                  </Link>

                  <button
                    type="button"
                    onClick={() => toggleSave(ev.id)}
                    aria-label={isSaved ? "Bỏ lưu" : "Lưu vào yêu thích"}
                    className="absolute top-3.5 right-3.5 p-1"
                  >
                    <FavoriteHeartIcon isSaved={isSaved} />
                  </button>

                  <Link
                    href={`/events/${ev.id}`}
                    className="absolute inset-x-0 bottom-0 p-4 text-white"
                  >
                    <h3 className="text-[17px] font-bold leading-snug text-white line-clamp-2">
                      {ev.title}
                    </h3>
                    <p className="text-[13px] text-white/90 mt-0.5">
                      {ev.dateRange}
                    </p>
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        {/* 3. Location, Date & Category Filter Bar */}
        <div className="py-3 mb-7 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setSelectedCity("HCM")}
            aria-label="Vị trí của tôi"
            className="size-9 rounded-[8px] bg-primary hover:bg-emerald-700 text-white flex items-center justify-center transition-colors shrink-0"
          >
            <Navigation className="size-4 fill-current" />
          </button>

          <button
            type="button"
            onClick={cycleCity}
            className="h-9 px-3 rounded-[8px] border-[1.5px] border-primary bg-emerald-50/50 text-primary text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors"
          >
            <MapPin className="size-3.5" />
            <span>{cityButtonLabel}</span>
            <ChevronDown className="size-3.5" />
          </button>

          <button
            type="button"
            onClick={cycleDate}
            className={`h-9 px-3 rounded-[8px] text-[13px] inline-flex items-center gap-1.5 transition-colors ${
              selectedDate !== "ALL"
                ? "border-[1.5px] border-primary bg-emerald-50/50 text-primary font-semibold"
                : "border border-[#dfe3e5] bg-white text-[#141d23] font-medium hover:border-[#868f97]"
            }`}
          >
            <Calendar className="size-3.5 text-[#606970]" />
            <span>{dateButtonLabel}</span>
            <ChevronDown className="size-3.5 text-[#606970]" />
          </button>

          <span
            aria-hidden="true"
            className="h-5 w-px bg-[#dfe3e5] mx-1.5 hidden sm:inline-block"
          />

          {(
            [
              { code: "ALL", label: "Tất cả" },
              { code: "SPORT", label: "Thể thao" },
              { code: "CONCERT", label: "Hòa nhạc" },
              { code: "THEATER", label: "Sân khấu & Hài kịch" },
            ] as const
          ).map((genre) => {
            const isActive = selectedCategory === genre.code;
            return (
              <button
                key={genre.code}
                type="button"
                onClick={() => setSelectedCategory(genre.code)}
                className={`h-9 px-3.5 rounded-[8px] text-[13px] transition-colors ${
                  isActive
                    ? "border-[1.5px] border-primary bg-emerald-50/50 text-primary font-semibold"
                    : "border border-[#dfe3e5] bg-white text-[#141d23] font-medium hover:border-[#868f97]"
                }`}
              >
                {genre.label}
              </button>
            );
          })}
        </div>

        {/* 4. Trending Events Near Location */}
        <div className="space-y-12">
          {trendingEvents.length > 0 && (
            <section aria-labelledby="heading-trending">
              <div className="flex items-center justify-between mb-4">
                <h2
                  id="heading-trending"
                  className="text-[19px] font-bold tracking-[-0.01em] text-[#141d23]"
                >
                  Sự kiện thịnh hành tại {cityButtonLabel}
                </h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {trendingEvents.map((ev) => (
                  <EventGridCard
                    key={ev.id}
                    event={ev}
                    isSaved={savedIds.includes(ev.id)}
                    onToggleSave={toggleSave}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 5. Popular Categories */}
          <section aria-labelledby="heading-categories">
            <h2
              id="heading-categories"
              className="text-[19px] font-bold tracking-[-0.01em] text-[#141d23] mb-4"
            >
              Danh mục phổ biến
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {POPULAR_CATEGORIES.map((cat) => (
                <button
                  key={cat.title}
                  type="button"
                  onClick={() => setSelectedCategory(cat.category)}
                  className="group relative aspect-[16/10] w-full overflow-hidden rounded-[14px] bg-[#141d23] text-left"
                >
                  <Image
                    src={cat.image}
                    alt={cat.title}
                    fill
                    unoptimized
                    sizes="(max-width: 640px) 50vw, 25vw"
                    className="h-full w-full object-cover brightness-75 transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <span className="absolute bottom-3 left-3.5 text-[15px] font-bold text-white">
                    {cat.title}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* 6. Concerts */}
          {concertEvents.length > 0 && (
            <section aria-labelledby="heading-concerts">
              <div className="flex items-center justify-between mb-4">
                <h2
                  id="heading-concerts"
                  className="text-[19px] font-bold tracking-[-0.01em] text-[#141d23]"
                >
                  Hòa nhạc
                </h2>
                <button
                  type="button"
                  onClick={() => setSelectedCategory("CONCERT")}
                  className="text-[13px] font-medium text-primary hover:underline"
                >
                  Khám phá Hòa nhạc
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {concertEvents.map((ev) => (
                  <EventGridCard
                    key={ev.id}
                    event={ev}
                    isSaved={savedIds.includes(ev.id)}
                    onToggleSave={toggleSave}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 7. Sports */}
          {sportEvents.length > 0 && (
            <section aria-labelledby="heading-sports">
              <div className="flex items-center justify-between mb-4">
                <h2
                  id="heading-sports"
                  className="text-[19px] font-bold tracking-[-0.01em] text-[#141d23]"
                >
                  Thể thao
                </h2>
                <button
                  type="button"
                  onClick={() => setSelectedCategory("SPORT")}
                  className="text-[13px] font-medium text-primary hover:underline"
                >
                  Khám phá Thể thao
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {sportEvents.map((ev) => (
                  <EventGridCard
                    key={ev.id}
                    event={ev}
                    isSaved={savedIds.includes(ev.id)}
                    onToggleSave={toggleSave}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 8. Theater & Comedy */}
          {theaterEvents.length > 0 && (
            <section aria-labelledby="heading-theater">
              <div className="flex items-center justify-between mb-4">
                <h2
                  id="heading-theater"
                  className="text-[19px] font-bold tracking-[-0.01em] text-[#141d23]"
                >
                  Sân khấu &amp; Hài kịch
                </h2>
                <button
                  type="button"
                  onClick={() => setSelectedCategory("THEATER")}
                  className="text-[13px] font-medium text-primary hover:underline"
                >
                  Khám phá Sân khấu
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {theaterEvents.map((ev) => (
                  <EventGridCard
                    key={ev.id}
                    event={ev}
                    isSaved={savedIds.includes(ev.id)}
                    onToggleSave={toggleSave}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 9. Artist Tour Notification Banner */}
          <div className="rounded-[12px] border border-[#dfe3e5] bg-white px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center -space-x-3 shrink-0">
                <Image
                  src="/images/events/vn/ha-anh-tuan.jpg"
                  alt=""
                  width={44}
                  height={44}
                  unoptimized
                  className="size-11 rounded-full object-cover border-2 border-white"
                />
                <Image
                  src="/images/events/vn/my-tam.jpg"
                  alt=""
                  width={44}
                  height={44}
                  unoptimized
                  className="size-11 rounded-full object-cover border-2 border-white"
                />
                <Image
                  src="/images/events/vn/soobin.jpg"
                  alt=""
                  width={44}
                  height={44}
                  unoptimized
                  className="size-11 rounded-full object-cover border-2 border-white"
                />
              </div>
              <p className="text-[16px] sm:text-[17px] font-bold text-[#141d23]">
                Nhận thông báo ngay khi nghệ sĩ yêu thích của bạn mở bán vé
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAlertSubscribed(true)}
              className="rounded-[8px] bg-[#141d23] hover:bg-[#2b343a] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors shrink-0"
            >
              {alertSubscribed ? "Đã đăng ký" : "Đăng ký nhận tin"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
