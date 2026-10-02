/* eslint-disable i18next/no-literal-string -- Latvian-only toy page,
   no catalogs (see docs/plans/SINGLE_PAGES_REACT_REWRITE.md). */
import { useEffect, useRef, useState } from 'react';
import FieldList from '../components/FieldList';
import { useTwisterAudio } from '../components/useTwisterAudio';

// Same default field values as twister.html.
const DEFAULT_PLAYERS = ['Kārlis'];
const DEFAULT_PARTS = ['Kreisā kāja', 'Labā kāja', 'Labā roka', 'Kreisā roka'];
const DEFAULT_ANIMALS = [
  'Dzīvnieks pēc brīvas izvēles',
  'Zilonis',
  'Kaķis',
  'Pērtiķis',
  'Suns',
  'Lauva',
  'Govs',
];
const DEFAULT_COLORS = [
  'Krāsas lauciņš pēc brīvas izvēles',
  'Sarkanais lauciņš',
  'Zils lauciņš',
  'Dzeltens lauciņš',
  'Zaļš lauciņš',
];

interface GameLists {
  players: string[];
  parts: string[];
  animals: string[];
  colors: string[];
}

const nonEmpty = (items: string[]) =>
  items.filter((item) => item.trim() !== '');

const pick = (items: string[]) =>
  items.length ? items[Math.floor(Math.random() * items.length)] : '';

/**
 * The twister move announcer — port of twister.html's game loop.
 * "Spēlēt!" cleans the lists, prefetches every field's audio, then
 * loops moves: players cycle in order, each move draws a random body
 * part, animal and color and speaks them sequentially via TTS.
 * Checking Pauze stops scheduling after the current move finishes
 * (the template's exact semantics); Spēlēt! restarts.
 */
export default function Twister() {
  const [players, setPlayers] = useState(DEFAULT_PLAYERS);
  const [parts, setParts] = useState(DEFAULT_PARTS);
  const [animals, setAnimals] = useState(DEFAULT_ANIMALS);
  const [colors, setColors] = useState(DEFAULT_COLORS);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  // The move currently being announced — also the audio-failure
  // fallback the silent template never had.
  const [move, setMove] = useState<string[] | null>(null);

  // Pause + interval are read live at schedule time (the template
  // read the DOM in the setTimeout continuation), so they stay
  // uncontrolled inputs behind refs — mid-game changes apply to the
  // next move, same as before.
  const pauseRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<HTMLInputElement>(null);
  // Bumped per start/stop so a superseded game loop stops scheduling.
  const runRef = useRef(0);
  const timeoutRef = useRef<number | undefined>(undefined);
  const { prefetch, playSequence, stop } = useTwisterAudio();

  const stopGame = () => {
    runRef.current += 1;
    window.clearTimeout(timeoutRef.current);
    stop();
    setLoading(false);
    setPlaying(false);
  };

  const loop = async (lists: GameLists, index: number, run: number) => {
    const player = lists.players[index % lists.players.length];
    const current = [
      player,
      pick(lists.parts),
      pick(lists.animals),
      pick(lists.colors),
    ].filter((text) => text !== '');
    setMove(current);
    const completed = await playSequence(current);
    if (!completed || run !== runRef.current) return;
    if (pauseRef.current?.checked) {
      setPlaying(false);
      return;
    }
    const secs = parseFloat(intervalRef.current?.value ?? '') || 5;
    timeoutRef.current = window.setTimeout(
      () => void loop(lists, index + 1, run),
      secs * 1000,
    );
  };

  const start = async () => {
    stopGame();
    setError('');
    const run = ++runRef.current;
    // removeEmptyFields parity: blank rows are dropped on start.
    const lists: GameLists = {
      players: nonEmpty(players),
      parts: nonEmpty(parts),
      animals: nonEmpty(animals),
      colors: nonEmpty(colors),
    };
    setPlayers(lists.players);
    setParts(lists.parts);
    setAnimals(lists.animals);
    setColors(lists.colors);
    if (!lists.players.length) {
      setError('Ievadiet vismaz vienu spēlētāju');
      return;
    }
    setLoading(true);
    // The template fired the fetches after starting the loop, so the
    // first moves always played silence — here the prefetch lands
    // first and move one is audible.
    await prefetch([
      ...lists.players,
      ...lists.parts,
      ...lists.animals,
      ...lists.colors,
    ]);
    if (run !== runRef.current) return;
    setLoading(false);
    setPlaying(true);
    // The template's loop started at index 1 (moveLog counted
    // players[0] as move 0 — dead code, but the skip was real);
    // kept for parity.
    void loop(lists, 1, run);
  };

  // Route unmount: kill the pending timeout + audio via stopGame's
  // pieces (the audio hook pauses mid-flight audio itself).
  useEffect(
    () => () => {
      runRef.current += 1;
      window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return (
    <div className="twister-page">
      <a href="/" className="home-link">
        ← home
      </a>
      <h1>Spēlējam Twister!</h1>
      <form onSubmit={(e) => e.preventDefault()}>
        <FieldList
          label="Spelētāji"
          values={players}
          onChange={setPlayers}
        />
        <FieldList
          label="Ķermeņa daļas"
          values={parts}
          onChange={setParts}
        />
        <FieldList
          label="Dzīvnieku lauki (ja nav - atstāt tukšu)"
          values={animals}
          onChange={setAnimals}
        />
        <FieldList
          label="Krāsu lauki"
          values={colors}
          onChange={setColors}
        />
        <div className="timeout-container">
          <div className="field-list-label">
            <label htmlFor="timeout-value">Starplaiks (s):</label>
          </div>
          <input
            type="number"
            id="timeout-value"
            ref={intervalRef}
            defaultValue="5"
            min="0"
          />
        </div>
        <button type="button" onClick={() => void start()}
          disabled={loading}>
          {loading ? 'Ielādē audio…' : 'Spēlēt!'}
        </button>
        {error && <div className="form-error">{error}</div>}
      </form>
      <div className="pause-row">
        <input
          className="checkbox"
          type="checkbox"
          id="Pause"
          ref={pauseRef}
        />
        <label htmlFor="Pause">Pauze</label>
      </div>
      {playing && move && move.length > 0 && (
        <p className="current-move">{move.join(' · ')}</p>
      )}
    </div>
  );
}
