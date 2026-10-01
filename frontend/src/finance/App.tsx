import { Navigate, Route, Routes } from 'react-router-dom';
import Accounts from './routes/Accounts';
import Balances from './routes/Balances';
import CategoryOverview from './routes/CategoryOverview';
import ConnectBank from './routes/ConnectBank';
import Limits from './routes/Limits';
import Rules from './routes/Rules';
import Transactions from './routes/Transactions';

/**
 * Router host for the finance SPA (strangler-mounted at
 * /finance/app/ — see `BrowserRouter basename` in main.tsx).
 * `/` redirects to `/accounts`, matching the post-cutover default;
 * unknown paths do the same. The Django `app/<path:subpath>`
 * catch-all serves the shell for every deep link, so React Router
 * resolves the page here. All routes are Stage 1 stubs — Stages 2–5
 * fill them per docs/plans/FINANCE_REACT_REWRITE.md.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/accounts" replace />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/connect" element={<ConnectBank />} />
      <Route path="/transactions" element={<Transactions />} />
      <Route path="/balances" element={<Balances />} />
      <Route path="/limits" element={<Limits />} />
      <Route path="/rules" element={<Rules />} />
      <Route path="/categories" element={<CategoryOverview />} />
      <Route path="*" element={<Navigate to="/accounts" replace />} />
    </Routes>
  );
}
