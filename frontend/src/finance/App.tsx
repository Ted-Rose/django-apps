import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '../shared/api/client';
import { pushToast } from '../shared/toasts';
import { fetchNotifications, type NotificationsReadIn } from './api';
import Accounts from './routes/Accounts';
import Balances from './routes/Balances';
import CategoryOverview from './routes/CategoryOverview';
import ConnectBank from './routes/ConnectBank';
import Limits from './routes/Limits';
import Rules from './routes/Rules';
import Transactions from './routes/Transactions';

/**
 * Drains unread in-app Notification rows into toasts — the
 * "next login" fallback for balance alerts when the user has no
 * Web Push subscription (and a breach audit trail when they do).
 * Runs once per SPA visit: rows are marked read once surfaced and
 * the cache is emptied so in-SPA navigation can't re-toast them.
 */
function useNotificationToasts() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['finance', 'notifications'],
    queryFn: fetchNotifications,
    staleTime: Infinity,
  });
  useEffect(() => {
    const items = data?.notifications;
    if (!items?.length) return;
    for (const n of items) {
      pushToast(`${n.title} — ${n.body}`, 'warning');
    }
    apiPost('/api/finance/notifications/read/', {
      ids: items.map((n) => n.id),
    } satisfies NotificationsReadIn)
      .then(() =>
        queryClient.setQueryData(['finance', 'notifications'], {
          notifications: [],
        }),
      )
      .catch(() => {});
  }, [data, queryClient]);
}

/**
 * Router host for the finance SPA mounted at /finance/ (see
 * `BrowserRouter basename` in main.tsx). `/` redirects to
 * `/accounts`; unknown paths do the same. Django's named shell
 * routes plus the `<path:subpath>` catch-all serve the shell for
 * every deep link, so React Router resolves the page here.
 */
export default function App() {
  useNotificationToasts();
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
