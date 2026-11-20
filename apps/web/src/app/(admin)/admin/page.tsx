import { AdminPage } from "@/features/moderation";
import { redirect } from "next/navigation";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  if (view === "audit") redirect("/admin/events/control");
  return <AdminPage />;
}
