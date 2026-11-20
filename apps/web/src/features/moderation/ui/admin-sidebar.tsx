"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ClipboardCheck,
  Home,
  LogOut,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { useSession } from "@/features/identity";
import { Logo } from "@/shared/ui/logo";
import { Button } from "@/shared/ui/button";

const links = [
  { href: "/admin/moderation", label: "Kiểm duyệt", Icon: ClipboardCheck },
  {
    href: "/admin/events/control",
    label: "Điều khiển sự kiện",
    Icon: ShieldAlert,
  },
  { href: "/admin/dashboard", label: "Đối soát và chi trả", Icon: Wallet },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useSession();

  return (
    <aside className="flex shrink-0 flex-col gap-2 border-b bg-background p-3 md:w-56 md:border-r md:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <Logo />
        <span className="text-xs font-semibold text-muted-foreground">
          Quản trị
        </span>
      </div>
      <nav
        aria-label="Điều hướng quản trị"
        className="flex flex-wrap gap-1 md:flex-1 md:flex-col md:pt-4"
      >
        {links.map(({ href, label, Icon }) => {
          const active =
            pathname === href ||
            (href === "/admin/moderation" && pathname === "/admin") ||
            (href === "/admin/events/control" &&
              pathname.startsWith("/admin/events/"));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-secondary aria-[current=page]:font-semibold"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t pt-2">
        <p className="truncate px-2 text-xs text-muted-foreground">
          {user?.fullName}
        </p>
        <div className="mt-1 flex items-center gap-1">
          <Link
            href="/"
            aria-label="Về trang chủ"
            className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Home aria-hidden="true" className="size-4 shrink-0" />
            Về trang chủ
          </Link>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Đăng xuất"
            onClick={async () => {
              await logout();
              router.replace("/auth");
            }}
          >
            <LogOut aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
