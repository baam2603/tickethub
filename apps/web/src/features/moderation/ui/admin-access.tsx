"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useSession } from "@/features/identity";
import { QueryProvider } from "@/shared/providers/query-provider";
import { AdminSidebar } from "./admin-sidebar";

export function AdminAccess({ children }: { children: ReactNode }) {
  const { user, isLoading } = useSession();

  if (isLoading)
    return (
      <p role="status" className="p-6">
        Đang kiểm tra phiên đăng nhập...
      </p>
    );
  if (user?.role !== "ADMIN") {
    return (
      <div className="space-y-3 p-6">
        <h1 className="text-lg font-semibold">Khu vực quản trị</h1>
        <p>Tính năng này yêu cầu tài khoản quản trị viên.</p>
        <Link href={user ? "/" : "/auth/login"} className="underline">
          {user ? "Về trang chủ" : "Đăng nhập"}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/30 text-foreground md:h-dvh md:flex-row md:overflow-hidden">
      <AdminSidebar />
      <main className="flex min-w-0 flex-1 flex-col md:overflow-auto">
        <QueryProvider>{children}</QueryProvider>
      </main>
    </div>
  );
}
