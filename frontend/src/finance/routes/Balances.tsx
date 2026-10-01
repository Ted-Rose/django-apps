import FinanceNavBar from '../components/FinanceNavBar';
import Toasts from '../../shared/components/Toasts';

/**
 * Stage 1 placeholder for the balances page — balance cards and the
 * "Get latest balance" refresh land in Stage 5. Until then the
 * template UI at /finance/balances/ stays live.
 */
export default function Balances() {
  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="h4">
          <i className="bi bi-cash-coin" /> Balances
        </h1>
        <p className="text-muted">
          Coming soon — the React version of this page is built in a later
          stage. The <a href="/finance/balances/">template version</a> is still
          live.
        </p>
      </div>
      <Toasts />
    </>
  );
}
