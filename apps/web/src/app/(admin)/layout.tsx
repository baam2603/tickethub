import { AdminAccess } from "@/features/moderation";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AdminAccess>{children}</AdminAccess>;
}
