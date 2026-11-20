import { VnpayReturnPage } from "@/features/payment";
import { QueryProvider } from "@/shared/providers/query-provider";

export default function Page() {
  return (
    <QueryProvider>
      <VnpayReturnPage />
    </QueryProvider>
  );
}
