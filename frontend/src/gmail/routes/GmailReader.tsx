import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import GmailNavBar from '../components/GmailNavBar';
import MessageCard from '../components/MessageCard';
import { useAudioQueue } from '../components/useAudioQueue';
import { fetchMessages, fetchStatus } from '../api';
import { useMarkRead } from '../mutations';
import { errorDetail } from '../../shared/api/errors';

/**
 * The Gmail reader page — React port of gmail.html's ?get_messages
 * branch:
 *
 * - Status gate: GET /api/gmail/status/ on mount; has_credentials
 *   false → navigate to /login/?next=<current spa url> (the
 *   @google_auth_required eager bounce the template page had).
 * - The query lives in ?query= (shareable/bookmarkable; the
 *   /gmail-to-audio 301 preserves it, and spa_url_for round-trips it
 *   through the OAuth `next` flow).
 * - Auto-fetch when the URL already carries `query` or
 *   `get_messages` — covers 301'd legacy links and the post-OAuth
 *   oauth_redirect_url.
 * - Mark-as-read flags are client-side (the template dimmed the card
 *   and disabled the button; the server mutation is fire-and-forget
 *   — a 401 google_reauth bounces via the shared API client).
 */
export default function GmailReader() {
  const { t } = useTranslation('gmail');
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('query') ?? '';
  const requested =
    searchParams.has('query') || searchParams.has('get_messages');

  // The template's input has a literal default value of "is: unread";
  // the SPA prefers the shareable URL state when present.
  const [inputValue, setInputValue] = useState(query || 'is: unread');
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());

  const status = useQuery({
    queryKey: ['gmail', 'status'],
    queryFn: fetchStatus,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (status.data && !status.data.has_credentials) {
      const next = window.location.pathname + window.location.search;
      window.location.assign(`/login/?next=${encodeURIComponent(next)}`);
    }
  }, [status.data]);

  const messagesQuery = useQuery({
    queryKey: ['gmail', 'messages', query],
    queryFn: () => fetchMessages(query),
    enabled: requested,
  });
  const messages = messagesQuery.data?.messages ?? [];

  // A new query result resets the per-card read flags — same ids in
  // a refreshed list are still unread server-side — and re-syncs the
  // input (e.g. landing back from OAuth with ?query= in the URL).
  useEffect(() => {
    setReadIds(new Set());
    setInputValue(query || 'is: unread');
  }, [query]);

  const markRead = useMarkRead();
  const audioQueue = useAudioQueue(messages);

  function markOne(id: string) {
    if (!window.confirm(t('message.markReadConfirm'))) return;
    markRead.mutate([id], {
      onSuccess: () => setReadIds((prev) => new Set(prev).add(id)),
    });
  }

  function markAll() {
    if (
      !window.confirm(t('reader.markAllConfirm', { count: messages.length }))
    ) {
      return;
    }
    const ids = messages.map((m) => m.id);
    markRead.mutate(ids, {
      onSuccess: () => setReadIds(new Set(ids)),
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (requested && inputValue === query) {
      // Same query resubmitted — re-run the fetch (the template did
      // a full page GET every time).
      messagesQuery.refetch();
      return;
    }
    setSearchParams({ query: inputValue, get_messages: '' });
  }

  if (status.isPending) {
    return (
      <>
        <GmailNavBar />
        <div className="container-fluid px-3 py-4">
          <div className="alert alert-info">
            <i className="bi bi-hourglass-split" /> {t('reader.checkingAccess')}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <GmailNavBar />
      <div className="container-fluid px-3 py-4">
        <div className="card mb-4">
          <div className="card-body">
            <h5 className="card-title">
              <i className="bi bi-filter" /> {t('reader.filterTitle')}
            </h5>
            <form onSubmit={onSubmit}>
              <div className="mb-3">
                <label htmlFor="query" className="form-label">
                  {t('reader.queryLabel')}
                </label>
                <input
                  type="text"
                  className="form-control"
                  id="query"
                  name="query"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={t('reader.queryPlaceholder')}
                />
              </div>
              <button
                type="submit"
                name="get_messages"
                className="btn btn-primary"
              >
                <i className="bi bi-envelope-open" /> {t('reader.getEmails')}
              </button>
            </form>
          </div>
        </div>

        {messagesQuery.isFetching && (
          <div className="alert alert-info">
            <i className="bi bi-hourglass-split" /> {t('reader.loading')}
          </div>
        )}

        {messagesQuery.isError && (
          <div className="alert alert-danger">
            <i className="bi bi-exclamation-triangle" />{' '}
            {t('reader.loadError', {
              detail: errorDetail(messagesQuery.error),
            })}
          </div>
        )}

        {messages.length > 0 && !messagesQuery.isFetching ? (
          <>
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h4 className="mb-0">
                <i className="bi bi-inbox" />{' '}
                {t('reader.found', { count: messages.length })}
              </h4>
              <button
                type="button"
                id="mark-all-read-btn"
                className="btn btn-success"
                onClick={markAll}
              >
                <i className="bi bi-envelope-open" /> {t('reader.markAllRead')}
              </button>
            </div>

            {messages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                read={readIds.has(message.id)}
                audioUrl={audioQueue.audioUrls[message.id]}
                audioRef={(el) => audioQueue.registerAudio(message.id, el)}
                onMarkRead={markOne}
                onPlay={audioQueue.play}
                onPlayAllFromHere={audioQueue.playAllFromHere}
              />
            ))}
          </>
        ) : (
          !messagesQuery.isFetching && (
            <div className="alert alert-info">
              <i className="bi bi-info-circle" /> {t('reader.empty')}
            </div>
          )
        )}
      </div>
    </>
  );
}
