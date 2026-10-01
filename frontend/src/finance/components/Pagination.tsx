/**
 * Pagination bar for the transactions page — a React port of the
 * `page_items`/`prev_page_url`/`next_page_url` block in
 * transactions.html. Page clicks write `?page=` via the `onPage`
 * callback instead of following pre-rendered hrefs.
 */

// Same arguments the view passes to get_elided_page_range.
const ON_EACH_SIDE = 2;
const ON_ENDS = 1;
const ELLIPSIS = '…' as const;

/** Inclusive [from, to] integer range (Python `range(a, b + 1)`). */
function pageRange(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

/**
 * Port of `Paginator.get_elided_page_range(page, on_each_side=2,
 * on_ends=1)` — e.g. page 9 of 20 → 1 … 7 8 9 10 11 … 20.
 */
function elidedPageRange(page: number, numPages: number): (number | '…')[] {
  if (numPages <= (ON_EACH_SIDE + ON_ENDS) * 2) {
    return pageRange(1, numPages);
  }
  const items: (number | '…')[] = [];
  if (page > 1 + ON_EACH_SIDE + ON_ENDS + 1) {
    items.push(
      ...pageRange(1, ON_ENDS),
      ELLIPSIS,
      ...pageRange(page - ON_EACH_SIDE, page),
    );
  } else {
    items.push(...pageRange(1, page));
  }
  if (page < numPages - ON_EACH_SIDE - ON_ENDS - 1) {
    items.push(
      ...pageRange(page + 1, page + ON_EACH_SIDE),
      ELLIPSIS,
      ...pageRange(numPages - ON_ENDS + 1, numPages),
    );
  } else {
    items.push(...pageRange(page + 1, numPages));
  }
  return items;
}

interface PaginationProps {
  page: number;
  numPages: number;
  count: number;
  hasNext: boolean;
  hasPrevious: boolean;
  onPage: (page: number) => void;
}

export function Pagination({
  page,
  numPages,
  count,
  hasNext,
  hasPrevious,
  onPage,
}: PaginationProps) {
  if (numPages <= 1) return null;
  return (
    <nav className="mt-3 tx-pagination" aria-label="Transaction pages">
      <ul className="pagination pagination-sm justify-content-center flex-wrap">
        <li className={`page-item${hasPrevious ? '' : ' disabled'}`}>
          <button
            type="button"
            className="page-link"
            aria-label="Previous"
            disabled={!hasPrevious}
            onClick={() => onPage(page - 1)}
          >
            &laquo;
          </button>
        </li>
        {elidedPageRange(page, numPages).map((item, index) =>
          item === ELLIPSIS ? (
            <li key={`ellipsis-${index}`} className="page-item disabled">
              <span className="page-link">&hellip;</span>
            </li>
          ) : (
            <li
              key={item}
              className={`page-item${item === page ? ' active' : ''}`}
            >
              <button
                type="button"
                className="page-link"
                onClick={() => onPage(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
        <li className={`page-item${hasNext ? '' : ' disabled'}`}>
          <button
            type="button"
            className="page-link"
            aria-label="Next"
            disabled={!hasNext}
            onClick={() => onPage(page + 1)}
          >
            &raquo;
          </button>
        </li>
      </ul>
      <p className="text-muted text-center small">
        Page {page} of {numPages} — {count} transactions
      </p>
    </nav>
  );
}

export default Pagination;
