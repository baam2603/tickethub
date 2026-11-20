export function EventControlStatus({ status }: { status: string }) {
  const suspended = status === "SUSPENDED";
  const published = status === "PUBLISHED";
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        suspended
          ? "bg-destructive/10 text-destructive"
          : published
            ? "bg-accent text-accent-foreground"
            : "bg-secondary text-secondary-foreground"
      }`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {suspended ? "Đang đình chỉ" : published ? "Đã công bố" : status}
    </span>
  );
}
