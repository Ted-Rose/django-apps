import { useCallback, useEffect, useRef } from 'react';
import { fetchAudio } from '../api';
import { hashOf } from '../utils';

/**
 * TTS audio prefetch cache + sequential player for the twister game
 * — the port of twister.html's createAudio / playAudios pair.
 *
 * Signed audio URLs are cached for the session in a Map keyed by
 * hashOf(text) (the same string is sent as `filename`, so repeated
 * phrases reuse the same server-side GCS object too). A phrase whose
 * fetch failed simply isn't in the cache and is skipped at playback —
 * the template's "audio element not found" console.error path.
 */
export function useTwisterAudio() {
  const cacheRef = useRef(new Map<string, string>());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Resolves the in-flight audio's await when stop() interrupts it —
  // without this a paused element would leave playSequence pending
  // forever.
  const finishRef = useRef<(() => void) | null>(null);
  const stoppedRef = useRef(false);

  /** Fetch (once per unique non-empty text) and cache every URL. */
  const prefetch = useCallback(async (texts: string[]) => {
    const unique = new Set(texts.map((t) => t.trim()).filter((t) => t !== ''));
    await Promise.all(
      [...unique].map(async (text) => {
        const key = hashOf(text);
        if (cacheRef.current.has(key)) return;
        try {
          const { audio_url } = await fetchAudio(text, 'lv', key);
          cacheRef.current.set(key, audio_url);
        } catch {
          // Per-field failure: the phrase just doesn't play.
        }
      }),
    );
  }, []);

  /**
   * Play the cached audio for each text in order (unknown texts are
   * skipped). Resolves false when stop() interrupted playback so the
   * game loop knows not to schedule the next move.
   */
  const playSequence = useCallback(async (texts: string[]) => {
    stoppedRef.current = false;
    for (const text of texts) {
      if (stoppedRef.current) return false;
      const url = cacheRef.current.get(hashOf(text));
      if (!url) continue;
      await new Promise<void>((resolve) => {
        const audio = new Audio(url);
        audioRef.current = audio;
        finishRef.current = resolve;
        const done = () => {
          if (finishRef.current === resolve) finishRef.current = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        // Rejected play() (e.g. unsupported source) skips ahead
        // instead of stalling the sequence.
        const playing = audio.play();
        if (playing !== undefined) playing.catch(done);
      });
      if (stoppedRef.current) return false;
    }
    return true;
  }, []);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    audioRef.current?.pause();
    finishRef.current?.();
  }, []);

  // Pause mid-flight audio when the page (route) unmounts.
  useEffect(() => stop, [stop]);

  return { prefetch, playSequence, stop };
}
