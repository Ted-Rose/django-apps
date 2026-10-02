import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fetchAudio } from '../api';
import { useTwisterAudio } from './useTwisterAudio';
import { hashOf } from '../utils';

vi.mock('../api', () => ({ fetchAudio: vi.fn() }));
const fetchMock = vi.mocked(fetchAudio);

/**
 * jsdom has no real media playback — FakeAudio fires `ended` on a
 * microtask (unless autoEnd is off, for the stop() test) and records
 * the src of every played element.
 */
class FakeAudio {
  static played: string[] = [];
  static autoEnd = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  paused = false;
  constructor(public src: string) {}
  play() {
    FakeAudio.played.push(this.src);
    if (FakeAudio.autoEnd) queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
vi.stubGlobal('Audio', FakeAudio);

describe('hashOf', () => {
  it('stays byte-identical to the template implementation', () => {
    // The hash is the GCS filename — same text, same object.
    expect(hashOf('abc')).toBe('hash96354');
    expect(hashOf('')).toBe('hash0');
  });
});

describe('useTwisterAudio', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (text: string) => ({
      audio_url: `u:${text}`,
    }));
    FakeAudio.played = [];
    FakeAudio.autoEnd = true;
  });

  it('prefetches each unique non-empty text once, cached by hash', async () => {
    const { result } = renderHook(() => useTwisterAudio());
    await result.current.prefetch(['a', 'a', 'b', '  ', '']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('a', 'lv', hashOf('a'));
    expect(fetchMock).toHaveBeenCalledWith('b', 'lv', hashOf('b'));

    // Second prefetch hits the cache.
    await result.current.prefetch(['a', 'b', 'c']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('plays each known text in order and resolves true', async () => {
    const { result } = renderHook(() => useTwisterAudio());
    await result.current.prefetch(['a', 'b']);
    // 'missing' was never prefetched — skipped, like the template's
    // "audio element not found" path.
    await expect(
      result.current.playSequence(['a', 'missing', 'b']),
    ).resolves.toBe(true);
    expect(FakeAudio.played).toEqual(['u:a', 'u:b']);
  });

  it('skips playback of texts whose prefetch failed', async () => {
    fetchMock.mockImplementation(async (text: string) => {
      if (text === 'bad') throw new Error('502');
      return { audio_url: `u:${text}` };
    });
    const { result } = renderHook(() => useTwisterAudio());
    await result.current.prefetch(['bad', 'ok']);
    await expect(
      result.current.playSequence(['bad', 'ok']),
    ).resolves.toBe(true);
    expect(FakeAudio.played).toEqual(['u:ok']);
  });

  it('stop() interrupts an in-flight sequence', async () => {
    FakeAudio.autoEnd = false;
    const { result } = renderHook(() => useTwisterAudio());
    await result.current.prefetch(['a', 'b']);
    const sequence = result.current.playSequence(['a', 'b']);
    result.current.stop();
    await expect(sequence).resolves.toBe(false);
    // The second text never started playing.
    expect(FakeAudio.played).toEqual(['u:a']);
  });
});
