import FinanceNavBar from '../components/FinanceNavBar';
import Toasts from '../../shared/components/Toasts';

/**
 * Stage 1 placeholder for the rules page — the categories card,
 * prioritized rules table and the sandbox-preview drawer land in
 * Stage 4. Until then the template UI at /finance/rules/ stays
 * live.
 */
export default function Rules() {
  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="h4">
          <i className="bi bi-funnel" /> Rules
        </h1>
        <p className="text-muted">
          Coming soon — the React version of this page is built in a later
          stage. The <a href="/finance/rules/">template version</a> is still
          live.
        </p>
      </div>
      <Toasts />
    </>
  );
}
