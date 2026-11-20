import { FaqAndLegalPage } from "@/features/support";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return <FaqAndLegalPage tab={tab} />;
}
