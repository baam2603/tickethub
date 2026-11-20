import Link from "next/link";
import type { LucideIcon } from "lucide-react";

interface HeroTab {
  key: string;
  label: string;
  icon: LucideIcon;
}

// Banner dau trang dung chung cho /faq va /guide. Tab la lien ket (?param=key),
// khong can JavaScript o trinh duyet.
export function SupportHero({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  description,
  tabs,
  activeKey,
  basePath,
  param,
}: {
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  title: string;
  description: string;
  tabs: HeroTab[];
  activeKey: string;
  basePath: string;
  param: string;
}) {
  return (
    <section className="bg-surface-dark text-white pt-24 pb-10 border-b border-border">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
        <div className="max-w-2xl space-y-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
            <EyebrowIcon className="size-3.5" aria-hidden="true" /> {eyebrow}
          </span>
          <h1 className="text-[24px] sm:text-[30px] font-extrabold tracking-tight leading-tight">
            {title}
          </h1>
          <p className="text-[13.5px] text-white/75 leading-relaxed">
            {description}
          </p>
        </div>
        <nav aria-label={title} className="mt-6 flex flex-wrap gap-2">
          {tabs.map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              href={`${basePath}?${param}=${key}`}
              prefetch={false}
              scroll={false}
              aria-current={key === activeKey ? "page" : undefined}
              className={`h-9 px-3.5 rounded-md text-[13px] font-bold inline-flex items-center gap-2 transition-colors ${
                key === activeKey
                  ? "bg-primary text-white"
                  : "bg-white/10 text-white/80 hover:bg-white/15 hover:text-white"
              }`}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </section>
  );
}
