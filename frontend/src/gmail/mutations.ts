/**
 * TanStack Query mutation hooks for POST /api/gmail/… — currently
 * just mark-read (per-card and mark-all share it). Read state is a
 * client-side visual flag like the template's markCardAsRead — no
 * ['gmail'] invalidation, since nothing refetches the list.
 */
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiPost } from '../shared/api/client';
import { errorDetail } from '../shared/api/errors';
import { pushToast } from '../shared/toasts';
import type { MarkReadIn, MarkReadOut } from './api';

/**
 * POST /api/gmail/mark-read/ — the 401 google_reauth bounce (missing
 * gmail.modify scope or dead creds) is handled globally by
 * shared/api/client.ts navigating to `authorization_url`; failures
 * land here as a toast (the template's alert() equivalent).
 */
export function useMarkRead() {
  const { t } = useTranslation('gmail');
  return useMutation({
    mutationFn: (messageIds: string[]) =>
      apiPost<MarkReadOut>('/api/gmail/mark-read/', {
        message_ids: messageIds,
      } satisfies MarkReadIn),
    onError: (error) =>
      pushToast(
        t('mutations.markReadFailed', { detail: errorDetail(error) }),
        'warning',
      ),
  });
}
