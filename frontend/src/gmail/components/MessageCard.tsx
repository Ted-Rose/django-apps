import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GmailMessageOut } from '../api';

/**
 * One message card — port of the {% for message in messages %} block
 * in gmail.html: subject/sender/id header, Show/Hide Body toggle and
 * the mark-as-read button (which flips to a disabled "Read" state and
 * dims the card on success, like the template's markCardAsRead).
 *
 * `audioUrl` is filled in by useAudioQueue once the audio GET
 * resolves — the <audio controls> slot mirrors the template's
 * `#audio-player-<id>` container. `audioRef` registers the element
 * with the queue so sequential playback can drive it.
 */
interface MessageCardProps {
  message: GmailMessageOut;
  read: boolean;
  audioUrl?: string;
  audioRef?: (el: HTMLAudioElement | null) => void;
  onMarkRead: (id: string) => void;
  onPlay: (id: string) => void;
  onPlayAllFromHere: (id: string) => void;
}

export function MessageCard({
  message,
  read,
  audioUrl,
  audioRef,
  onMarkRead,
  onPlay,
  onPlayAllFromHere,
}: MessageCardProps) {
  const { t } = useTranslation('gmail');
  const [showBody, setShowBody] = useState(false);

  return (
    <div
      id={`message-${message.id}-container`}
      className="card message-card mb-3"
      style={read ? { opacity: 0.55 } : undefined}
    >
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <div className="flex-grow-1">
            <h5 className="card-title subject">
              <i className="bi bi-chat-left-text" /> {message.subject}
            </h5>
            <p className="card-text text-muted sender mb-2">
              <i className="bi bi-person" /> {message.sender}
            </p>
            <small className="text-muted">
              <i className="bi bi-hash" />{' '}
              {t('message.idLabel', { id: message.id })}
            </small>
          </div>
        </div>

        <div className="mb-3">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary body-toggle-btn"
            onClick={() => setShowBody((v) => !v)}
          >
            <i className={`bi ${showBody ? 'bi-eye-slash' : 'bi-eye'}`} />{' '}
            {showBody ? t('message.hideBody') : t('message.showBody')}
          </button>{' '}
          <button
            type="button"
            className={`btn btn-sm mark-read-btn ${
              read ? 'btn-success' : 'btn-outline-success'
            }`}
            disabled={read}
            onClick={() => onMarkRead(message.id)}
          >
            <i className={`bi ${read ? 'bi-check2' : 'bi-envelope-open'}`} />{' '}
            {read ? t('message.read') : t('message.markRead')}
          </button>
        </div>

        <div
          className={`message-body alert alert-light${showBody ? ' show' : ''}`}
        >
          <strong>{t('message.bodyLabel')}</strong>
          <div className="mt-2">{message.body}</div>
        </div>

        <div id={`audio-player-${message.id}`} className="mb-3">
          {audioUrl && <audio controls src={audioUrl} ref={audioRef} />}
        </div>

        <div className="btn-group" role="group">
          <button
            type="button"
            className="btn btn-primary play-audio"
            onClick={() => onPlay(message.id)}
          >
            <i className="bi bi-play-circle" /> {t('message.play')}
          </button>
          <button
            type="button"
            className="btn btn-success play-all-audios"
            onClick={() => onPlayAllFromHere(message.id)}
          >
            <i className="bi bi-play-fill" /> {t('message.playAllFromHere')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MessageCard;
