// apps/web/src/app/(organizer)/layout.tsx
import { OrganizerHeader } from "@/features/organizer";
import Link from "next/link";

export default function OrganizerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-muted/30 text-foreground">
      {/* Primary Organizer Header */}
      <OrganizerHeader />

      {/* Main Workspace */}
      <main className="flex-1 w-full">{children}</main>

      {/* Calm, Professional Back-Office Footer */}
      <footer className="border-t border-border bg-background py-5 mt-12 text-xs text-muted-foreground">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="font-medium text-foreground">tickethub Ban Tổ Chức</p>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-foreground transition-colors">
              Trang chủ
            </Link>
            <span className="text-border" aria-hidden="true">
              •
            </span>
            <Link
              href="/faq?tab=privacy"
              className="hover:text-foreground transition-colors"
            >
              Chính sách bảo mật
            </Link>
            <span className="text-border" aria-hidden="true">
              •
            </span>
            <Link
              href="/faq"
              className="hover:text-foreground transition-colors"
            >
              Trung tâm hỗ trợ
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
