import { SystemGuidePage } from "@/features/support";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  return <SystemGuidePage role={role} />;
}
