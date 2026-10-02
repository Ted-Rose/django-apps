import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiGet } from '../../shared/api/client';
import { clearToasts } from '../../shared/toasts';
import {
  audioText,
  circularOrder,
  MAX_AUDIO_TEXT_LENGTH,
  useAudioQueue,
} from './useAudioQueue';
import type { GmailMessageOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);

function makeMessage(id: string, body = `body-${id}`): GmailMessageOut {
  return { id, subject: `subject-${id}`, sender: `sender-${id}`, body };
}

function Harness({ messages }: { messages: GmailMessageOut[] }) {
  const queue = useAudioQueue(messages);
  return (
    <>
      {messages.map((m) => (
        <div key={m.id}>
          {queue.audioUrls[m.id] && (
            <audio
              src={queue.audioUrls[m.id]}
              ref={(el) => queue.registerAudio(m.id, el)}
            />
          )}
          <button onClick={() => queue.play(m.id)}>play-{m.id}</button>
          <button onClick={() => queue.playAllFromHere(m.id)}>
            all-{m.id}
          </button>
        </div>
      ))}
    </>
  );
}

function renderHarness(messages: GmailMessageOut[]) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Harness messages={messages} />
    </QueryClientProvider>,
  );
}

function audioFor(id: string): HTMLAudioElement {
  const el = document.querySelector<HTMLAudioElement>(
    `audio[src="/audio/${id}.mp3"]`,
  );
  if (!el) throw new Error(`audio element for ${id} not rendered`);
  return el;
}

describe('circularOrder', () => {
  it('wraps end → start from the clicked message', () => {
    expect(circularOrder(['a', 'b', 'c', 'd'], 'b')).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
    expect(circularOrder(['a', 'b', 'c', 'd'], 'a')).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(circularOrder(['a', 'b', 'c', 'd'], 'd')).toEqual([
      'd',
      'a',
      'b',
      'c',
    ]);
  });

  it('returns empty for an unknown id', () => {
    expect(circularOrder(['a'], 'zzz')).toEqual([]);
  });
});

describe('audioText', () => {
  it('joins subject, sender and body with newlines', () => {
    expect(audioText(makeMessage('m1'))).toBe('subject-m1\nsender-m1\nbody-m1');
  });

  it('truncates at 2300 chars plus the truncation marker', () => {
    const msg = makeMessage('m1', 'x'.repeat(5000));
    const text = audioText(msg);
    expect(text.startsWith('subject-m1\nsender-m1\n')).toBe(true);
    expect(text).toContain('... (message truncated for audio)');
    expect(text.length).toBe(
      MAX_AUDIO_TEXT_LENGTH + '... (message truncated for audio)'.length,
    );
  });
});

describe('useAudioQueue', () => {
  const played: string[] = [];
  let playSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedApiGet.mockReset();
    mockedApiGet.mockImplementation((url: string) => {
      const filename = new URLSearchParams(url.split('?')[1]).get('filename');
      return Promise.resolve({ audio_url: `/audio/${filename}.mp3` });
    });
    played.length = 0;
    playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(function (this: HTMLMediaElement) {
        played.push(this.getAttribute('src') ?? '');
        return Promise.resolve();
      });
    clearToasts();
  });

  it('fetches audio lazily per message and plays it', async () => {
    const { getByText } = renderHarness([makeMessage('m1'), makeMessage('m2')]);
    fireEvent.click(getByText('play-m2'));
    await waitFor(() => audioFor('m2'));
    await waitFor(() => expect(played).toContain('/audio/m2.mp3'));
    expect(playSpy).toHaveBeenCalled();
  });

  it('Play All From Here plays the circular order on ended', async () => {
    const { getByText } = renderHarness([
      makeMessage('a'),
      makeMessage('b'),
      makeMessage('c'),
      makeMessage('d'),
    ]);
    fireEvent.click(getByText('all-b'));

    // Parity: audio for the whole circular list is fetched up front.
    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(4));
    const fetched = mockedApiGet.mock.calls.map(([url]) =>
      new URLSearchParams(String(url).split('?')[1]).get('filename'),
    );
    expect(fetched).toEqual(['b', 'c', 'd', 'a']);

    await waitFor(() => audioFor('a'));
    await waitFor(() => expect(played).toEqual(['/audio/b.mp3']));

    fireEvent(audioFor('b'), new Event('ended'));
    await waitFor(() =>
      expect(played).toEqual(['/audio/b.mp3', '/audio/c.mp3']),
    );

    fireEvent(audioFor('c'), new Event('ended'));
    fireEvent(audioFor('d'), new Event('ended'));
    await waitFor(() =>
      expect(played).toEqual([
        '/audio/b.mp3',
        '/audio/c.mp3',
        '/audio/d.mp3',
        '/audio/a.mp3',
      ]),
    );

    // The wrap-around 'a' is the last one — queue is done.
    fireEvent(audioFor('a'), new Event('ended'));
    await waitFor(() => expect(played).toHaveLength(4));
  });

  it('Play only plays the clicked message (playOnlyCurrent parity)', async () => {
    const { getByText } = renderHarness([
      makeMessage('a'),
      makeMessage('b'),
      makeMessage('c'),
    ]);
    fireEvent.click(getByText('play-c'));

    // The whole list's audio is still generated — only playback is
    // limited to the clicked message.
    await waitFor(() => expect(mockedApiGet).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(played).toEqual(['/audio/c.mp3']));

    fireEvent(audioFor('c'), new Event('ended'));
    await waitFor(() => expect(played).toEqual(['/audio/c.mp3']));
  });
});
