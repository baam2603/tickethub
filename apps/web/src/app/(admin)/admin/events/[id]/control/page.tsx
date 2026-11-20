import { EventControlPage } from "@/features/moderation";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EventControlPage eventId={id} />;
}
