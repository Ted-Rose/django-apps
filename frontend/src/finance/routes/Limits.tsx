import FinanceNavBar from '../components/FinanceNavBar';
import Toasts from '../../shared/components/Toasts';

/**
 * Stage 1 placeholder for the limits page — the limit form, window
 * progress bars, month overview and push-alert card land in
 * Stage 5. Until then the template UI at /finance/limits/ stays
 * live.
 */
export default function Limits() {
  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="h4">
          <i className="bi bi-speedometer2" /> Limits
        </h1>
        <p className="text-muted">
          Coming soon — the React version of this page is built in a later
          stage. The <a href="/finance/limits/">template version</a> is still
          live.
        </p>
      </div>
      <Toasts />
    </>
  );
}
