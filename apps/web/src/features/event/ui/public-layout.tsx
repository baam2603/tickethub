// apps/web/src/app/(public)/layout.tsx
import Link from "next/link";
import { ShieldCheck, Clock, RefreshCcw, Globe } from "lucide-react";
import { PublicHeader } from "./public-header";

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-[#141d23]">
      {/* Main navigation header */}
      <PublicHeader />

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Site footer */}
      <footer className="border-t border-[#dfe3e5] bg-white pt-12 pb-10 mt-16">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 space-y-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-8">
            {/* Col 1: Buyer Guarantee (4 cols) */}
            <div className="lg:col-span-4 space-y-4">
              <div className="inline-flex items-center gap-2">
                <svg
                  width="24"
                  height="30"
                  viewBox="0 0 32 41"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M14.487 19.103l6.112-6.116 2.245 2.247-8.357 8.363-5.737-5.742 2.245-2.246 3.492 3.494zM15.735.131L31.45 5.374v13.23c0 4.743-1.996 9.237-5.488 12.357l-5.239 4.743-3.616-.998 6.86-6.116c2.868-2.497 4.49-6.116 4.49-9.986V7.745L15.858 3.501 3.262 7.745v11.109c0 3.744 1.622 7.489 4.49 9.985l8.107 7.24 2.37 2.121-2.37 2.122-10.227-9.111C2.14 28.09.144 23.597.144 18.854V5.498L15.734.131z"
                    fill="#059669"
                  />
                </svg>
                <span className="font-extrabold text-[17px] tracking-tight text-[#141d23]">
                  tickethub Protect
                </span>
              </div>

              <ul className="space-y-3 text-[12.5px] text-[#2b343a]">
                <li className="flex items-center gap-2.5">
                  <span className="size-6 rounded-full bg-emerald-50 text-primary flex items-center justify-center shrink-0">
                    <ShieldCheck className="size-3.5" />
                  </span>
                  <span>Vé chính thức 100% từ Ban tổ chức</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="size-6 rounded-full bg-emerald-50 text-primary flex items-center justify-center shrink-0">
                    <Clock className="size-3.5" />
                  </span>
                  <span>Giữ chỗ riêng 5 phút khi thanh toán</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="size-6 rounded-full bg-emerald-50 text-primary flex items-center justify-center shrink-0">
                    <RefreshCcw className="size-3.5" />
                  </span>
                  <span>Hoàn tiền đầy đủ nếu sự kiện bị hủy</span>
                </li>
              </ul>
            </div>

            {/* Col 2: Về TicketHub (3 cols) */}
            <div className="lg:col-span-3 space-y-2.5 text-[13px]">
              <h4 className="font-bold text-[#141d23]">Về tickethub</h4>
              <ul className="space-y-2 text-[#2b343a]">
                <li>
                  <Link
                    href="/#heading-concerts"
                    className="hover:text-primary transition-colors"
                  >
                    Giới thiệu
                  </Link>
                </li>
                <li>
                  <Link
                    href="/register?role=ORGANIZER"
                    className="hover:text-primary transition-colors"
                  >
                    Dành cho Ban tổ chức
                  </Link>
                </li>
                <li>
                  <Link
                    href="/register?role=ORGANIZER"
                    className="hover:text-primary transition-colors"
                  >
                    Hợp tác đối tác
                  </Link>
                </li>
                <li>
                  <Link
                    href="/login"
                    className="hover:text-primary transition-colors"
                  >
                    Tin tức sự kiện
                  </Link>
                </li>
                <li>
                  <Link
                    href="/login"
                    className="hover:text-primary transition-colors"
                  >
                    Tuyển dụng
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 3: Bạn cần hỗ trợ? (2 cols) */}
            <div className="lg:col-span-2 space-y-2.5 text-[13px]">
              <h4 className="font-bold text-[#141d23]">Bạn cần hỗ trợ?</h4>
              <ul className="space-y-2 text-[#2b343a]">
                <li>
                  <Link
                    href="/faq"
                    className="hover:text-primary transition-colors"
                  >
                    Trung tâm trợ giúp
                  </Link>
                </li>
                <li>
                  <Link
                    href="/my-tickets"
                    className="hover:text-primary transition-colors"
                  >
                    Tra cứu vé đã đặt
                  </Link>
                </li>
                <li>
                  <Link
                    href="/faq?tab=refund"
                    className="hover:text-primary transition-colors"
                  >
                    Chính sách hoàn tiền
                  </Link>
                </li>
                <li>
                  <Link
                    href="/guide"
                    className="hover:text-primary transition-colors"
                  >
                    Hướng dẫn sử dụng
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 4: Khu vực & Tiền tệ (3 cols) */}
            <div className="lg:col-span-3 space-y-2.5 text-[13px]">
              <h4 className="font-bold text-[#141d23]">
                Sự kiện trên toàn quốc
              </h4>
              <div className="space-y-2">
                <div className="rounded-[8px] border border-[#dfe3e5] px-3.5 py-2 text-[13px] text-[#2b343a] flex items-center gap-2.5">
                  <svg
                    width="18"
                    height="12"
                    viewBox="0 0 30 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                    className="rounded-[2px] shrink-0"
                  >
                    <rect width="30" height="20" fill="#DA251D" />
                    <polygon
                      points="15,4 16.47,8.52 21.22,8.52 17.38,11.31 18.85,15.83 15,13.04 11.15,15.83 12.62,11.31 8.78,8.52 13.53,8.52"
                      fill="#FFFF00"
                    />
                  </svg>
                  <span>Việt Nam</span>
                </div>
                <div className="rounded-[8px] border border-[#dfe3e5] px-3.5 py-2 text-[13px] text-[#2b343a] space-y-2">
                  <div className="flex items-center gap-2 pb-2 border-b border-[#dfe3e5]">
                    <Globe className="size-3.5 text-[#606970]" />
                    <span>Tiếng Việt (VN)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#141d23] text-[12px]">
                      ₫
                    </span>
                    <span>Đồng Việt Nam (VND)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-[#dfe3e5] text-[11.5px] text-[#606970] leading-relaxed">
            © 2026 tickethub Vietnam. Việc sử dụng trang web này đồng nghĩa với
            việc bạn đồng ý với{" "}
            <Link
              href="/faq?tab=terms"
              className="underline hover:text-[#141d23]"
            >
              Điều khoản sử dụng
            </Link>
            ,{" "}
            <Link
              href="/faq?tab=privacy"
              className="underline hover:text-[#141d23]"
            >
              Chính sách bảo mật
            </Link>{" "}
            và{" "}
            <Link
              href="/faq?tab=refund"
              className="underline hover:text-[#141d23]"
            >
              Chính sách hoàn tiền
            </Link>{" "}
            của chúng tôi.
          </div>
        </div>
      </footer>
    </div>
  );
}
