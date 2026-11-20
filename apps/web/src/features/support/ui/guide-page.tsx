import Link from "next/link";
import { BookOpen, Building2, QrCode, Ticket } from "lucide-react";
import {
  GUIDE_BY_ROLE,
  GUIDE_ROLES,
  GUIDE_TIP,
  parseGuideRole,
} from "../data/guide-content";
import { SupportHero } from "./support-hero";

const ROLE_ICONS = { buyer: Ticket, organizer: Building2, staff: QrCode };

// Trang render tren may chu, khong anh minh hoa va khong can JavaScript o trinh duyet.
export function SystemGuidePage({ role }: { role?: string | undefined }) {
  const active = parseGuideRole(role);
  const guide = GUIDE_BY_ROLE[active];
  return (
    <div className="bg-muted min-h-screen pb-14">
      <SupportHero
        eyebrow="Hướng dẫn"
        eyebrowIcon={BookOpen}
        title="Hướng dẫn sử dụng TicketHub"
        description="Các bước đơn giản dành cho người mua vé, ban tổ chức và nhân viên soát vé."
        tabs={GUIDE_ROLES.map((r) => ({ ...r, icon: ROLE_ICONS[r.key] }))}
        activeKey={active}
        basePath="/guide"
        param="role"
      />
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 space-y-6">
        <div className="bg-card border border-border rounded-lg p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-[14px] text-foreground">{guide.summary}</p>
          <Link
            href={guide.ctaHref}
            className="h-9 px-4 rounded-md bg-primary hover:bg-primary/90 text-white text-[13px] font-bold inline-flex items-center justify-center shrink-0 transition-colors"
          >
            {guide.ctaLabel}
          </Link>
        </div>

        <ol className="space-y-4">
          {guide.steps.map((step, index) => (
            <li
              key={step.title}
              className="bg-card border border-border rounded-lg shadow-sm p-5 sm:p-6 flex gap-4"
            >
              <span className="size-9 shrink-0 rounded-full bg-primary text-white font-bold text-[14px] inline-flex items-center justify-center">
                {index + 1}
              </span>
              <div className="space-y-2.5 min-w-0">
                <h2 className="text-[16px] font-bold text-foreground">
                  {step.title}
                </h2>
                <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
                <ul className="list-disc pl-5 space-y-1 text-[13px] text-foreground">
                  {step.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>

        <section className="bg-card border border-border rounded-lg p-5 sm:p-6 shadow-sm space-y-1">
          <h2 className="text-[15px] font-bold text-foreground">
            {GUIDE_TIP.title}
          </h2>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {GUIDE_TIP.body}
          </p>
          <Link
            href="/faq"
            className="inline-block pt-2 text-[13px] font-bold text-primary hover:underline"
          >
            Xem câu hỏi thường gặp
          </Link>
        </section>
      </div>
    </div>
  );
}
