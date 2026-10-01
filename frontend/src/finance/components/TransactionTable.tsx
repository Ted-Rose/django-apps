import { useState, type CSSProperties, type ReactNode } from 'react';
import Dropdown from '../../shared/components/Dropdown';
import CategoryBadge from './CategoryBadge';
import type { TransactionOut, TransactionsOut } from '../api';

/**
 * Search-param overrides the route merges via `useSearchParams` —
 * `null` removes the key. The route also resets `page` on any update
 * that doesn't carry `page` itself.
 */
export type ParamUpdates = Record<string, string | null>;

interface TransactionTableProps {
  data: TransactionsOut;
  onUpdate: (updates: ParamUpdates) => void;
}

/**
 * The transactions.html table: every column header is a Dropdown
 * whose menu carries the column's sort options plus its filter
 * controls — the account/category option lists, the creditor
 * typeahead and the description search box all come from the single
 * TransactionsOut payload. Rows render `booking_date` via
 * toLocaleDateString (the local-datetime port) and the raw amount
 * string + currency (money stays a string; only the sign is read
 * for coloring).
 */
export function TransactionTable({ data, onUpdate }: TransactionTableProps) {
  const { sort, direction } = data;

  const setSort = (column: string, dir: 'asc' | 'desc') => {
    // date+desc is the default ordering — the template's page_url
    // omits it, so clear the params instead of setting them.
    onUpdate(
      column === 'date' && dir === 'desc'
        ? { sort: null, direction: null }
        : { sort: column, direction: dir },
    );
  };

  const scrollableMenu: CSSProperties = {
    maxHeight: '300px',
    overflowY: 'auto',
  };

  return (
    <div className="table-responsive">
      <table className="table table-striped table-hover">
        <thead>
          <tr>
            <ColumnHeader
              label="Date"
              column="date"
              sort={sort}
              direction={direction}
            >
              <SortItem
                label="Newest first"
                active={sort === 'date' && direction === 'desc'}
                onClick={() => setSort('date', 'desc')}
              />
              <SortItem
                label="Oldest first"
                active={sort === 'date' && direction === 'asc'}
                onClick={() => setSort('date', 'asc')}
              />
            </ColumnHeader>
            <ColumnHeader
              label="Account"
              column="account"
              sort={sort}
              direction={direction}
              filtered={data.selected_account != null}
              menuStyle={scrollableMenu}
            >
              <SortItem
                label="Sort A → Z"
                active={sort === 'account' && direction === 'asc'}
                onClick={() => setSort('account', 'asc')}
              />
              <SortItem
                label="Sort Z → A"
                active={sort === 'account' && direction === 'desc'}
                onClick={() => setSort('account', 'desc')}
              />
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <h6 className="dropdown-header">Filter</h6>
              </li>
              <FilterItem
                label="All accounts"
                active={data.selected_account == null}
                onClick={() => onUpdate({ account: null })}
              />
              {data.accounts.map((option) => (
                <FilterItem
                  key={option.id}
                  label={option.label}
                  active={data.selected_account === option.id}
                  onClick={() => onUpdate({ account: String(option.id) })}
                />
              ))}
            </ColumnHeader>
            <ColumnHeader
              label="Description"
              column="description"
              sort={sort}
              direction={direction}
              filtered={Boolean(data.search_query)}
              menuStyle={{ minWidth: '240px' }}
            >
              <SortItem
                label="Sort A → Z"
                active={sort === 'description' && direction === 'asc'}
                onClick={() => setSort('description', 'asc')}
              />
              <SortItem
                label="Sort Z → A"
                active={sort === 'description' && direction === 'desc'}
                onClick={() => setSort('description', 'desc')}
              />
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <form
                  className="px-3 py-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = String(
                      new FormData(event.currentTarget).get('q') ?? '',
                    ).trim();
                    onUpdate({ q: value || null });
                  }}
                >
                  <div className="input-group input-group-sm">
                    <input
                      type="text"
                      name="q"
                      className="form-control"
                      key={data.search_query}
                      defaultValue={data.search_query}
                      placeholder="Search..."
                      aria-label="Search descriptions"
                    />
                    <button
                      type="submit"
                      className="btn btn-outline-secondary"
                      aria-label="Search"
                    >
                      <i className="bi bi-search" />
                    </button>
                  </div>
                </form>
              </li>
            </ColumnHeader>
            <ColumnHeader
              label="Creditor"
              column="creditor"
              sort={sort}
              direction={direction}
              filtered={Boolean(data.selected_creditor)}
              menuStyle={scrollableMenu}
            >
              <SortItem
                label="Sort A → Z"
                active={sort === 'creditor' && direction === 'asc'}
                onClick={() => setSort('creditor', 'asc')}
              />
              <SortItem
                label="Sort Z → A"
                active={sort === 'creditor' && direction === 'desc'}
                onClick={() => setSort('creditor', 'desc')}
              />
              <li>
                <hr className="dropdown-divider" />
              </li>
              <CreditorMenuItems
                counterparties={data.counterparties}
                selected={data.selected_creditor}
                onUpdate={onUpdate}
              />
            </ColumnHeader>
            <ColumnHeader
              label="Category"
              column="category"
              sort={sort}
              direction={direction}
              filtered={Boolean(data.selected_category)}
              menuStyle={scrollableMenu}
            >
              <SortItem
                label="Sort A → Z"
                active={sort === 'category' && direction === 'asc'}
                onClick={() => setSort('category', 'asc')}
              />
              <SortItem
                label="Sort Z → A"
                active={sort === 'category' && direction === 'desc'}
                onClick={() => setSort('category', 'desc')}
              />
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <h6 className="dropdown-header">Filter</h6>
              </li>
              <FilterItem
                label="All categories"
                active={!data.selected_category}
                onClick={() => onUpdate({ category: null })}
              />
              <FilterItem
                label="Uncategorized"
                active={data.selected_category === 'none'}
                onClick={() => onUpdate({ category: 'none' })}
              />
              {data.categories.map((category) => (
                <FilterItem
                  key={category.id}
                  label={category.name}
                  active={data.selected_category === String(category.id)}
                  onClick={() =>
                    onUpdate({ category: String(category.id) })
                  }
                />
              ))}
            </ColumnHeader>
            <ColumnHeader
              label="Amount"
              column="amount"
              sort={sort}
              direction={direction}
              end
            >
              <SortItem
                label="Largest first"
                active={sort === 'amount' && direction === 'desc'}
                onClick={() => setSort('amount', 'desc')}
              />
              <SortItem
                label="Smallest first"
                active={sort === 'amount' && direction === 'asc'}
                onClick={() => setSort('amount', 'asc')}
              />
            </ColumnHeader>
          </tr>
        </thead>
        <tbody>
          {data.transactions.length > 0 ? (
            data.transactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))
          ) : (
            <tr>
              <td colSpan={6} className="text-center text-muted py-4">
                {data.filters_active
                  ? 'No transactions match the selected filters.'
                  : 'No transactions synced yet. Transactions are synced every 6 hours by a scheduled job.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A column header: the shared Dropdown restyled as the template's
 * `btn-link` toggle, with the sort-direction arrow and the
 * `bi-funnel-fill` marker when that column's filter is active.
 */
function ColumnHeader({
  label,
  column,
  sort,
  direction,
  filtered = false,
  end = false,
  menuStyle,
  children,
}: {
  label: string;
  column: string;
  sort: string;
  direction: string;
  filtered?: boolean;
  /** Right-aligned header + `dropdown-menu-end` (the Amount column). */
  end?: boolean;
  menuStyle?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <th className={end ? 'text-end' : undefined}>
      <Dropdown
        buttonClassName="btn btn-link p-0 border-0 text-reset fw-bold dropdown-toggle"
        menuClassName={end ? 'dropdown-menu-end' : ''}
        menuStyle={menuStyle}
        label={
          <>
            {label}
            {sort === column && (
              <i
                className={`bi bi-arrow-${
                  direction === 'desc' ? 'down' : 'up'
                } ms-1`}
              />
            )}
            {filtered && <i className="bi bi-funnel-fill ms-1" />}
          </>
        }
      >
        {children}
      </Dropdown>
    </th>
  );
}

function SortItem({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={`dropdown-item${active ? ' active' : ''}`}
        onClick={onClick}
      >
        {label}
      </button>
    </li>
  );
}

const FilterItem = SortItem;

/**
 * Creditor filter menu section — the template's `creditor-menu`:
 * a typeahead input filtering the distinct-counterparty list
 * client-side (the `creditor-search` inline script), plus an
 * "All creditors" reset item.
 */
function CreditorMenuItems({
  counterparties,
  selected,
  onUpdate,
}: {
  counterparties: string[];
  selected: string;
  onUpdate: (updates: ParamUpdates) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = counterparties.filter(
    (name) => !needle || name.toLowerCase().includes(needle),
  );
  return (
    <>
      <li>
        <h6 className="dropdown-header">Filter</h6>
      </li>
      <li className="px-3 pb-1">
        <input
          type="text"
          className="form-control form-control-sm"
          placeholder="Search creditors..."
          aria-label="Search creditors"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </li>
      <FilterItem
        label="All creditors"
        active={!selected}
        onClick={() => onUpdate({ creditor: null })}
      />
      {visible.map((name) => (
        <FilterItem
          key={name}
          label={name}
          active={selected === name}
          onClick={() => onUpdate({ creditor: name })}
        />
      ))}
    </>
  );
}

function TransactionRow({ tx }: { tx: TransactionOut }) {
  // booking_date is a date-only string; appending T00:00:00 parses it
  // as local midnight (the template's local-datetime behavior)
  // instead of UTC midnight, which toLocaleDateString would roll
  // back a day behind UTC.
  const bookingDate = new Date(`${tx.booking_date}T00:00:00`);
  // Money stays a string — read only the sign for coloring.
  const negative = tx.amount.startsWith('-');
  return (
    <tr>
      <td>{bookingDate.toLocaleDateString()}</td>
      <td>{tx.account.name || tx.account.iban || ''}</td>
      <td>{tx.remittance_information || '-'}</td>
      <td>{tx.counterparty || '-'}</td>
      <td>
        {tx.effective_category ? (
          <CategoryBadge category={tx.effective_category} />
        ) : (
          <span className="text-muted">-</span>
        )}
      </td>
      <td
        className={`text-end ${negative ? 'text-danger' : 'text-success'}`}
      >
        {tx.amount} {tx.currency}
      </td>
    </tr>
  );
}

export default TransactionTable;
