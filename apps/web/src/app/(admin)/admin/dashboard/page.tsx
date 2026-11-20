import Link from "next/link";
import { PayoutView, ReconciliationView } from "@/features/settlement";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const payout = (await searchParams).view === "payouts";
  return (
    <section className="space-y-5 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Đối soát và chi trả</h1>
      <nav
        aria-label="Nghiệp vụ quyết toán"
        className="flex flex-wrap gap-2 border-b pb-2 text-sm"
      >
        <Link
          href="/admin/dashboard"
          aria-current={!payout ? "page" : undefined}
          className="rounded-md px-3 py-2 aria-[current=page]:bg-secondary aria-[current=page]:font-semibold"
        >
          Đối soát
        </Link>
        <Link
          href="/admin/dashboard?view=payouts"
          aria-current={payout ? "page" : undefined}
          className="rounded-md px-3 py-2 aria-[current=page]:bg-secondary aria-[current=page]:font-semibold"
        >
          Chi trả
        </Link>
      </nav>
      {payout ? <PayoutView /> : <ReconciliationView />}
    </section>
  );
}
