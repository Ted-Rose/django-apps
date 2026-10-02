import { useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Dropdown from '../../shared/components/Dropdown';
import CategoryBadge from './CategoryBadge';
import MoneyText from './MoneyText';
import { fmtDate } from '../../shared/format';
import { useAssignCategory, useClearManualCategory } from '../mutations';
import type { CategoryOut, TransactionOut, TransactionsOut } from '../api';

/**
 * Search-param overrides the route merges via `useSearchParams` —
 * `null` removes the key. The route also resets `page` on any update
 * that doesn't carry `page` itself.
 */
export type ParamUpdates = Record<string, string | null>;

interface TransactionTableProps {
  data: TransactionsOut;
  onUpdate: (updates: ParamUpdates) => void;
  /** Opens the rule drawer prefilled from the row's transaction. */
  onAddRule: (tx: TransactionOut) => void;
  /** Transaction id whose rule form is still loading (spinner). */
  ruleLoadingId?: number | null;
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
 *
 * Below the lg breakpoint finance.css turns the table into a card
 * list (the header row becomes a wrap-around filter bar, each row a
 * card) and rearranges cells via their `tx-cell-*` classes — the
 * markup here stays a plain table so desktop is unchanged.
 */
export function TransactionTable({
  data,
  onUpdate,
  onAddRule,
  ruleLoadingId = null,
}: TransactionTableProps) {
  const { t } = useTranslation('finance');
  const { sort, direction } = data;
  // Rules assign a category, so the row action is pointless without one.
  const hasCategories = data.categories.length > 0;

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
      <table className="table table-hover align-middle tx-table">
        <thead>
          <tr>
            <ColumnHeader
              label={t('transactions.columns.date')}
              column="date"
              sort={sort}
              direction={direction}
            >
              <SortItem
                label={t('transactions.sort.newestFirst')}
                active={sort === 'date' && direction === 'desc'}
                onClick={() => setSort('date', 'desc')}
              />
              <SortItem
                label={t('transactions.sort.oldestFirst')}
                active={sort === 'date' && direction === 'asc'}
                onClick={() => setSort('date', 'asc')}
              />
            </ColumnHeader>
            <ColumnHeader
              label={t('transactions.columns.account')}
              column="account"
              sort={sort}
              direction={direction}
              filtered={data.selected_account != null}
              menuStyle={scrollableMenu}
            >
              <SortItem
                label={t('transactions.sort.az')}
                active={sort === 'account' && direction === 'asc'}
                onClick={() => setSort('account', 'asc')}
              />
              <SortItem
                label={t('transactions.sort.za')}
                active={sort === 'account' && direction === 'desc'}
                onClick={() => setSort('account', 'desc')}
              />
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <h6 className="dropdown-header">
                  {t('transactions.filterHeader')}
                </h6>
              </li>
              <FilterItem
                label={t('transactions.allAccounts')}
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
              label={t('transactions.columns.description')}
              column="description"
              sort={sort}
              direction={direction}
              filtered={Boolean(data.search_query)}
              menuStyle={{ minWidth: '240px' }}
            >
              <SortItem
                label={t('transactions.sort.az')}
                active={sort === 'description' && direction === 'asc'}
                onClick={() => setSort('description', 'asc')}
              />
              <SortItem
                label={t('transactions.sort.za')}
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
                      placeholder={t('transactions.searchPlaceholder')}
                      aria-label={t('transactions.searchDescriptionsAria')}
                    />
                    <button
                      type="submit"
                      className="btn btn-outline-secondary"
                      aria-label={t('common:common.search')}
                    >
                      <i className="bi bi-search" />
                    </button>
                  </div>
                </form>
              </li>
            </ColumnHeader>
            <ColumnHeader
              label={t('transactions.columns.creditor')}
              column="creditor"
              sort={sort}
              direction={direction}
              filtered={Boolean(data.selected_creditor)}
              menuStyle={scrollableMenu}
            >
              <SortItem
                label={t('transactions.sort.az')}
                active={sort === 'creditor' && direction === 'asc'}
                onClick={() => setSort('creditor', 'asc')}
              />
              <SortItem
                label={t('transactions.sort.za')}
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
              label={t('transactions.columns.category')}
              column="category"
              sort={sort}
              direction={direction}
              filtered={
                Boolean(data.selected_category) || Boolean(data.selected_source)
              }
              menuStyle={scrollableMenu}
            >
              <SortItem
                label={t('transactions.sort.az')}
                active={sort === 'category' && direction === 'asc'}
                onClick={() => setSort('category', 'asc')}
              />
              <SortItem
                label={t('transactions.sort.za')}
                active={sort === 'category' && direction === 'desc'}
                onClick={() => setSort('category', 'desc')}
              />
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <h6 className="dropdown-header">
                  {t('transactions.filterHeader')}
                </h6>
              </li>
              <FilterItem
                label={t('transactions.allCategories')}
                active={!data.selected_category}
                onClick={() => onUpdate({ category: null })}
              />
              <FilterItem
                label={t('transactions.uncategorized')}
                active={data.selected_category === 'none'}
                onClick={() => onUpdate({ category: 'none' })}
              />
              {data.categories.map((category) => (
                <FilterItem
                  key={category.id}
                  label={category.name}
                  active={data.selected_category === String(category.id)}
                  onClick={() => onUpdate({ category: String(category.id) })}
                />
              ))}
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <h6 className="dropdown-header">
                  {t('transactions.sourceHeader')}
                </h6>
              </li>
              <FilterItem
                label={t('transactions.allSources')}
                active={!data.selected_source}
                onClick={() => onUpdate({ source: null })}
              />
              <FilterItem
                label={t('transactions.manualOnly')}
                active={data.selected_source === 'manual'}
                onClick={() => onUpdate({ source: 'manual' })}
              />
            </ColumnHeader>
            <ColumnHeader
              label={t('transactions.columns.amount')}
              column="amount"
              sort={sort}
              direction={direction}
              end
            >
              <SortItem
                label={t('transactions.sort.largestFirst')}
                active={sort === 'amount' && direction === 'desc'}
                onClick={() => setSort('amount', 'desc')}
              />
              <SortItem
                label={t('transactions.sort.smallestFirst')}
                active={sort === 'amount' && direction === 'asc'}
                onClick={() => setSort('amount', 'asc')}
              />
            </ColumnHeader>
          </tr>
        </thead>
        <tbody>
          {data.transactions.length > 0 ? (
            data.transactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                categories={data.categories}
                canAddRule={hasCategories}
                ruleLoading={ruleLoadingId === tx.id}
                onAddRule={onAddRule}
              />
            ))
          ) : (
            <tr>
              <td colSpan={6} className="text-center text-muted py-4">
                {data.filters_active
                  ? t('transactions.emptyFiltered')
                  : t('transactions.emptyDefault')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A column header: the shared Dropdown with a `.fin-chip` pill
 * toggle, the sort-direction arrow and the `bi-funnel-fill` marker
 * when that column's filter is active. `btn-link` stays on the
 * button so finance.css's mobile chip-bar rules still match.
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
        buttonClassName="btn btn-link fin-chip dropdown-toggle"
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
  label: ReactNode;
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
  const { t } = useTranslation('finance');
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = counterparties.filter(
    (name) => !needle || name.toLowerCase().includes(needle),
  );
  return (
    <>
      <li>
        <h6 className="dropdown-header">{t('transactions.filterHeader')}</h6>
      </li>
      <li className="px-3 pb-1">
        <input
          type="text"
          className="form-control form-control-sm"
          placeholder={t('transactions.searchCreditors')}
          aria-label={t('transactions.searchCreditorsAria')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </li>
      <FilterItem
        label={t('transactions.allCreditors')}
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

function TransactionRow({
  tx,
  categories,
  canAddRule,
  ruleLoading,
  onAddRule,
}: {
  tx: TransactionOut;
  categories: CategoryOut[];
  canAddRule: boolean;
  ruleLoading: boolean;
  onAddRule: (tx: TransactionOut) => void;
}) {
  const { t } = useTranslation('finance');
  const assign = useAssignCategory();
  const clearManual = useClearManualCategory();
  // booking_date is a date-only string; appending T00:00:00 parses it
  // as local midnight (the template's local-datetime behavior)
  // instead of UTC midnight, which toLocaleDateString would roll
  // back a day behind UTC.
  const bookingDate = `${tx.booking_date}T00:00:00`;
  // Money stays a string — read only the sign for coloring.
  const negative = tx.amount.startsWith('-');
  const currentId = tx.effective_category?.id ?? null;
  return (
    <tr>
      <td className="tx-cell-date">{fmtDate(bookingDate)}</td>
      <td className="tx-cell-account">
        {tx.account.name || tx.account.iban || ''}
      </td>
      <td className="tx-cell-desc">{tx.remittance_information || '-'}</td>
      <td className="tx-cell-counterparty">{tx.counterparty || '-'}</td>
      {/* The badge itself is the assign-category dropdown toggle —
          Monarch/YNAB-style: click the pill, pick a category. The
          menu also carries the per-row rule action and, for manual
          overrides, the revert item. */}
      <td className="tx-cell-category">
        <Dropdown
          buttonClassName="tx-cat-toggle"
          menuStyle={{ maxHeight: '300px', overflowY: 'auto' }}
          ariaLabel={t('transactions.categoryMenuAria', { id: tx.id })}
          label={
            tx.effective_category ? (
              <>
                <CategoryBadge category={tx.effective_category} />
                {tx.category_is_manual ? (
                  <i
                    className="bi bi-pencil-fill tx-manual-mark"
                    title={t('transactions.manualMark')}
                    aria-hidden="true"
                  />
                ) : null}
              </>
            ) : (
              <span className="tx-cat-empty">
                {t('transactions.setCategory')}
              </span>
            )
          }
        >
          <li>
            <h6 className="dropdown-header">
              {t('transactions.assignCategory')}
            </h6>
          </li>
          {categories.map((category) => (
            <FilterItem
              key={category.id}
              label={
                <>
                  {currentId === category.id && (
                    <i className="bi bi-check me-1" aria-hidden="true" />
                  )}
                  {category.name}
                </>
              }
              active={currentId === category.id}
              onClick={() =>
                assign.mutate({ txId: tx.id, categoryId: category.id })
              }
            />
          ))}
          <FilterItem
            label={t('transactions.noCategory')}
            active={currentId === null}
            onClick={() => assign.mutate({ txId: tx.id, categoryId: null })}
          />
          <li>
            <hr className="dropdown-divider" />
          </li>
          <li>
            <button
              type="button"
              className="dropdown-item"
              title={canAddRule ? undefined : t('transactions.addRuleDisabled')}
              aria-label={t('transactions.addRuleAria', { id: tx.id })}
              disabled={!canAddRule || ruleLoading}
              onClick={() => onAddRule(tx)}
            >
              {ruleLoading ? (
                <span
                  className="spinner-border spinner-border-sm me-1"
                  role="status"
                />
              ) : (
                <i className="bi bi-tag me-1" aria-hidden="true" />
              )}
              {t('transactions.createRuleFromTx')}
            </button>
          </li>
          {tx.category_is_manual && (
            <>
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() => clearManual.mutate(tx.id)}
                >
                  <i
                    className="bi bi-arrow-counterclockwise me-1"
                    aria-hidden="true"
                  />
                  {t('transactions.revertToAutomatic')}
                </button>
              </li>
            </>
          )}
        </Dropdown>
      </td>
      <td
        className={`tx-cell-amount text-end ${
          negative ? 'text-danger' : 'text-success'
        }`}
      >
        <MoneyText amount={tx.amount} currency={tx.currency} />
      </td>
    </tr>
  );
}

export default TransactionTable;
