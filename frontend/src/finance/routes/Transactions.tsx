import FinanceNavBar from '../components/FinanceNavBar';
import Toasts from '../../shared/components/Toasts';

/**
 * Stage 1 placeholder for the transactions page — the sortable,
 * filterable, paginated table lands in Stage 3. Until then the
 * template UI at /finance/transactions/ stays live.
 */
export default function Transactions() {
  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="h4">
          <i className="bi bi-arrow-left-right" /> Transactions
        </h1>
        <p className="text-muted">
          Coming soon — the React version of this page is built in a later
          stage. The <a href="/finance/transactions/">template version</a> is
          still live.
        </p>
      </div>
      <Toasts />
    </>
  );
}
