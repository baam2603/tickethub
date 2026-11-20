import { Button } from "./button";

export function PageNavigation({
  page,
  hasMore,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <nav aria-label="Phân trang" className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        Trang trước
      </Button>
      <span className="text-sm">Trang {page}</span>
      <Button
        type="button"
        variant="outline"
        disabled={!hasMore}
        onClick={() => onChange(page + 1)}
      >
        Trang sau
      </Button>
    </nav>
  );
}
