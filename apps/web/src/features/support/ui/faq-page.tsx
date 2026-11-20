import {
  FileText,
  HelpCircle,
  Lock,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { LEGAL_TABS, parseLegalTab } from "../data/faq-content";
import { FaqExplorer } from "./faq-explorer";
import { PrivacySection, RefundSection, TermsSection } from "./legal-sections";
import { SupportHero } from "./support-hero";

const TAB_ICONS = {
  faq: HelpCircle,
  terms: FileText,
  privacy: Lock,
  refund: RefreshCcw,
};

// Trang render tren may chu; chi FaqExplorer chay o trinh duyet.
export function FaqAndLegalPage({ tab }: { tab?: string | undefined }) {
  const active = parseLegalTab(tab);
  return (
    <div className="bg-muted min-h-screen pb-14">
      <SupportHero
        eyebrow="Trung tâm hỗ trợ"
        eyebrowIcon={ShieldCheck}
        title="Câu hỏi thường gặp và chính sách"
        description="Giải đáp nhanh về đặt vé, thanh toán, vào cổng, hủy vé và cách chúng tôi bảo vệ thông tin của bạn."
        tabs={LEGAL_TABS.map((t) => ({ ...t, icon: TAB_ICONS[t.key] }))}
        activeKey={active}
        basePath="/faq"
        param="tab"
      />
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8">
        {active === "faq" && <FaqExplorer />}
        {active === "terms" && <TermsSection />}
        {active === "privacy" && <PrivacySection />}
        {active === "refund" && <RefundSection />}
      </div>
    </div>
  );
}
