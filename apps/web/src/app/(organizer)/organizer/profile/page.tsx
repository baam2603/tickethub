import { QueryProvider } from "@/shared/providers/query-provider";
import { OrganizerProfilePage } from "@/features/organizer";

export default function Page() {
  return (
    <QueryProvider>
      <OrganizerProfilePage />
    </QueryProvider>
  );
}
