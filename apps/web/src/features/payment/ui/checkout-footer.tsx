"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/** Chan trang va cam ket. */
export function CheckoutFooter() {
  return (
    <footer className="w-full border-t border-border bg-background mt-16 py-6 sm:py-8">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        {/* Left: Legal Links */}
        <div className="flex items-center gap-4 sm:gap-6 flex-wrap justify-center md:justify-start">
          <Link
            href="/faq?tab=terms"
            className="hover:text-foreground transition-colors"
          >
            Điều khoản sử dụng
          </Link>
          <Link
            href="/faq?tab=privacy"
            className="hover:text-foreground transition-colors"
          >
            Chính sách bảo mật
          </Link>
          <Link
            href="/faq?tab=refund"
            className="hover:text-foreground transition-colors"
          >
            Cam kết bảo vệ vé 100%
          </Link>
          <Link href="/faq" className="hover:text-foreground transition-colors">
            Trợ giúp
          </Link>
        </div>

        {/* Center: Guarantee Badge */}
        <div className="flex items-center gap-2 font-medium text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
          <span>Mọi đơn hàng đều được cam kết 100% chính hãng</span>
        </div>

        {/* Right: Copyright */}
        <div className="text-center md:text-right">
          © 2026 tickethub. All Rights Reserved.
        </div>
      </div>
    </footer>
  );
}
