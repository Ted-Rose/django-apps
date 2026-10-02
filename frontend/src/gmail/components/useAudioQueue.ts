import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchAudio, type GmailMessageOut } from '../api';
import { errorDetail } from '../../shared/api/errors';
import { pushToast } from '../../shared/toasts';

/**
 * Port of gmail.html's createAudio / createAllAudios /
 * autoplayAudios trio.
 *
 * - The audio URL for each message is fetched lazily through
 *   GET /api/gmail/audio/ and cached per message id (the template
 *   checked "does the card already contain an <audio>" — the map is
 *   that check).
 * - "Play" == the template's createAllAudios(id, playOnlyCurrent=true)
 *   sloppy-mode call: audio for the WHOLE circular list is generated
 *   up front, but only the clicked message plays.
 * - "Play All From Here" plays the full circular order — wrapping
 *   end → start via i=(i+1)%len — sequentially on 'ended'.
 * - The 2300-char truncation is verbatim: it keeps the GET URL under
 *   limits after encodeURIComponent expansion (~2× the 5000-char
 *   backend cap).
 */

// Must stay under the backend's 5000-char cap after URL encoding.
export const MAX_AUDIO_TEXT_LENGTH = 2300;

/**
 * The text read aloud for a message. The template scraped textContent
 * off the card DOM, which incidentally prepended the "Body:" label;
 * the SPA sends the clean field values instead.
 */
export function audioText(message: GmailMessageOut): string {
  let text = [message.subject, message.sender, message.body]
    .filter(Boolean)
    .join('\n');
  if (text.length > MAX_AUDIO_TEXT_LENGTH) {
    text =
      text.substring(0, MAX_AUDIO_TEXT_LENGTH) +
      '... (message truncated for audio)';
  }
  return text;
}

/** Circular playback order starting at firstId, wrapping end→start. */
export function circularOrder(ids: string[], firstId: string): string[] {
  const startIndex = ids.indexOf(firstId);
  if (startIndex === -1) return [];
  const order: string[] = [];
  for (
    let i = startIndex, n = 0;
    n < ids.length;
    i = (i + 1) % ids.length, n++
  ) {
    order.push(ids[i]);
  }
  return order;
}

export interface AudioQueue {
  /** id → signed audio URL once the audio GET resolves. */
  audioUrls: Record<string, string>;
  /** The message id currently playing, if any. */
  playingId: string | null;
  /** Callback ref — pass each card's <audio> element in/out. */
  registerAudio: (id: string, el: HTMLAudioElement | null) => void;
  /** "Play" — only this message's audio plays (template parity). */
  play: (id: string) => void;
  /** "Play All From Here" — the whole circular queue. */
  playAllFromHere: (id: string) => void;
}

export function useAudioQueue(messages: GmailMessageOut[]): AudioQueue {
  const { t } = useTranslation('gmail');
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  // Queue of message ids left to play; the head is the current one.
  const [queue, setQueue] = useState<string[]>([]);
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const pending = useRef(new Set<string>());

  const registerAudio = useCallback(
    (id: string, el: HTMLAudioElement | null) => {
      if (el) {
        audioEls.current.set(id, el);
      } else {
        audioEls.current.delete(id);
      }
    },
    [],
  );

  const ensureAudio = useCallback(
    (id: string) => {
      if (audioUrls[id] || pending.current.has(id)) return;
      const message = messages.find((m) => m.id === id);
      if (!message) return;
      pending.current.add(id);
      fetchAudio(audioText(message), id)
        .then((data) => {
          if (data?.audio_url) {
            setAudioUrls((prev) => ({
              ...prev,
              [id]: data.audio_url,
            }));
          }
        })
        .catch((error) =>
          pushToast(
            t('mutations.audioFailed', {
              detail: errorDetail(error),
            }),
            'warning',
          ),
        )
        .finally(() => pending.current.delete(id));
    },
    [audioUrls, messages, t],
  );

  const start = useCallback(
    (firstId: string, onlyFirst: boolean) => {
      const order = circularOrder(
        messages.map((m) => m.id),
        firstId,
      );
      if (!order.length) return;
      // Pause anything already playing before re-queuing — the
      // template's reset left the old playback chain running into
      // the new one.
      audioEls.current.forEach((el) => el.pause());
      // Parity: audio for the whole circular list is generated up
      // front regardless of playOnlyFirst.
      order.forEach(ensureAudio);
      setQueue(onlyFirst ? order.slice(0, 1) : order);
    },
    [messages, ensureAudio],
  );

  const play = useCallback((id: string) => start(id, true), [start]);
  const playAllFromHere = useCallback(
    (id: string) => start(id, false),
    [start],
  );

  // Drive the queue head: once its <audio> element exists (the fetch
  // may still be in flight — the effect re-runs when audioUrls
  // lands), play it and advance on 'ended'. A rejected play() (e.g.
  // an unsupported source) skips to the next instead of stalling the
  // queue.
  useEffect(() => {
    const id = queue[0];
    if (!id) return;
    const el = audioEls.current.get(id);
    if (!el) return;
    const onEnded = () => setQueue((q) => q.slice(1));
    el.addEventListener('ended', onEnded);
    el.play()?.catch(() => setQueue((q) => q.slice(1)));
    return () => el.removeEventListener('ended', onEnded);
  }, [queue, audioUrls]);

  return {
    audioUrls,
    playingId: queue[0] ?? null,
    registerAudio,
    play,
    playAllFromHere,
  };
}
