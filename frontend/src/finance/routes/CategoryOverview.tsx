import FinanceNavBar from '../components/FinanceNavBar';
import Toasts from '../../shared/components/Toasts';

/**
 * Stage 1 placeholder for the category overview page — per-category
 * spending over a selectable window lands in Stage 4. Until then
 * the template UI at /finance/categories/ stays live.
 */
export default function CategoryOverview() {
  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="h4">
          <i className="bi bi-pie-chart" /> Categories
        </h1>
        <p className="text-muted">
          Coming soon — the React version of this page is built in a later
          stage. The <a href="/finance/categories/">template version</a> is
          still live.
        </p>
      </div>
      <Toasts />
    </>
  );
}
