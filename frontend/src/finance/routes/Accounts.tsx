import FinanceNavBar from '../components/FinanceNavBar';
import Toasts from '../../shared/components/Toasts';

/**
 * Stage 1 placeholder for the accounts page — the real
 * implementation (account list, balance-check toggle, share form)
 * lands in Stage 2. Until then the template UI at
 * /finance/accounts/ stays live.
 */
export default function Accounts() {
  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="h4">
          <i className="bi bi-wallet2" /> Accounts
        </h1>
        <p className="text-muted">
          Coming soon — the React version of this page is built in a later
          stage. The <a href="/finance/accounts/">template version</a> is still
          live.
        </p>
      </div>
      <Toasts />
    </>
  );
}
