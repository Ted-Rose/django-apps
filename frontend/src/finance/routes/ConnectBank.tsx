import FinanceNavBar from '../components/FinanceNavBar';
import Toasts from '../../shared/components/Toasts';

/**
 * Stage 1 placeholder for the connect-bank flow — country picker →
 * institutions endpoint → POST /api/finance/connect/ →
 * window.location to the bank link lands in Stage 2. Until then the
 * template UI at /finance/connect/ stays live.
 */
export default function ConnectBank() {
  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="h4">
          <i className="bi bi-bank" /> Connect Bank
        </h1>
        <p className="text-muted">
          Coming soon — the React version of this page is built in a later
          stage. The <a href="/finance/connect/">template version</a> is still
          live.
        </p>
      </div>
      <Toasts />
    </>
  );
}
