"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { FAQ_CATEGORIES, FAQ_ITEMS } from "../data/faq-content";

// Phan duy nhat can trinh duyet: tim kiem va loc cau hoi. Moi cau hoi la <details> tu mo/dong.
export function FaqExplorer() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ_ITEMS.filter(
      (item) =>
        (category === "all" || item.category === category) &&
        (!q ||
          item.question.toLowerCase().includes(q) ||
          item.answer.toLowerCase().includes(q)),
    );
  }, [query, category]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <aside className="lg:col-span-4 space-y-4">
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm space-y-3">
          <label
            htmlFor="faq-search"
            className="block text-[12px] font-bold uppercase tracking-wider text-muted-foreground"
          >
            Tìm câu hỏi
          </label>
          <div className="relative">
            <Search
              className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="faq-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ví dụ: hoàn tiền, mã QR"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-muted text-[13px] text-foreground focus:outline-none focus:border-primary"
            />
          </div>
          <div className="pt-2 space-y-1">
            {FAQ_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                aria-pressed={category === cat.id}
                className={`w-full text-left px-3 py-2 rounded-md text-[13px] font-semibold transition-colors ${
                  category === cat.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 shadow-sm space-y-2">
          <h2 className="text-[14px] font-bold text-foreground">
            Cần hướng dẫn từng bước?
          </h2>
          <p className="text-[12.5px] text-muted-foreground leading-relaxed">
            Xem hướng dẫn dành cho người mua vé, ban tổ chức và nhân viên soát
            vé.
          </p>
          <Link
            href="/guide"
            className="inline-flex items-center text-[13px] font-bold text-primary hover:underline pt-1"
          >
            Mở trang Hướng dẫn sử dụng
          </Link>
        </div>
      </aside>

      <div className="lg:col-span-8 space-y-3">
        {items.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center">
            <p className="text-[14px] font-semibold text-foreground">
              Không tìm thấy câu hỏi phù hợp.
            </p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
              className="mt-3 h-8 px-3 rounded-md bg-muted border border-border text-[12px] font-bold text-foreground"
            >
              Xóa bộ lọc
            </button>
          </div>
        ) : (
          items.map((item, index) => (
            <details
              key={item.id}
              open={index === 0 && !query && category === "all"}
              className="group bg-card border border-border rounded-lg overflow-hidden shadow-sm"
            >
              <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-4 hover:bg-muted/60 transition-colors">
                <h3 className="text-[14.5px] font-bold text-foreground leading-snug">
                  {item.question}
                </h3>
                <ChevronDown
                  className="size-4 text-muted-foreground shrink-0 transition-transform group-open:rotate-180 group-open:text-primary"
                  aria-hidden="true"
                />
              </summary>
              <p className="px-5 pb-4 pt-3 border-t border-border/60 text-[13.5px] text-muted-foreground leading-relaxed">
                {item.answer}
              </p>
            </details>
          ))
        )}
      </div>
    </div>
  );
}
