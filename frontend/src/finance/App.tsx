import { Navigate, Route, Routes } from 'react-router-dom';
import Accounts from './routes/Accounts';
import Balances from './routes/Balances';
import CategoryOverview from './routes/CategoryOverview';
import ConnectBank from './routes/ConnectBank';
import Limits from './routes/Limits';
import Rules from './routes/Rules';
import Transactions from './routes/Transactions';

/**
 * Router host for the finance SPA mounted at /finance/ (see
 * `BrowserRouter basename` in main.tsx). `/` redirects to
 * `/accounts`; unknown paths do the same. Django's named shell
 * routes plus the `<path:subpath>` catch-all serve the shell for
 * every deep link, so React Router resolves the page here.
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
