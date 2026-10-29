import { describe, expect, it } from 'vitest';
import { spaPathFromStoredUrl, stripNoteMarker, truncateWords } from './utils';

/**
 * stripNoteMarker must mirror services.py NOTE_TAG_RE +
 * _collapse_marker_whitespace exactly — the cases below track the
 * backend unit tests (tasks.md 1.2) so the display layer hides the
 * same text the classifier matched.
 */
describe('stripNoteMarker', () => {
  it('strips a bare #notes marker', () => {
    expect(stripNoteMarker('call mom #notes')).toBe('call mom');
    expect(stripNoteMarker('#notes')).toBe('');
  });

  it('strips path markers from title and body text', () => {
    expect(stripNoteMarker('list #notes-household')).toBe('list');
    expect(stripNoteMarker('#notes-projects-django-apps deploy')).toBe(
      'deploy',
    );
    expect(stripNoteMarker('x #notes-bible_research-genesis y')).toBe('x y');
  });

  it('matches case-insensitively', () => {
    expect(stripNoteMarker('prayer #Notes-God-Prayer')).toBe('prayer');
    expect(stripNoteMarker('#NOTES')).toBe('');
  });

  it('strips every occurrence and collapses leftover whitespace', () => {
    expect(stripNoteMarker('a #notes-god b #notes-god-prayer c')).toBe('a b c');
    expect(stripNoteMarker('a   #notes   b')).toBe('a b');
  });

  it('does not strip #notebook or #notesx (lookahead edge)', () => {
    expect(stripNoteMarker('read #notebook-x')).toBe('read #notebook-x');
    expect(stripNoteMarker('fix #notesx')).toBe('fix #notesx');
  });

  it('does not strip a trailing-dash fragment', () => {
    // `#notes-` matches nothing — the lookahead rejects the marker.
    expect(stripNoteMarker('a #notes- b')).toBe('a #notes- b');
  });

  it('handles null/undefined input', () => {
    expect(stripNoteMarker(null)).toBe('');
    expect(stripNoteMarker(undefined)).toBe('');
  });
});

describe('truncateWords', () => {
  it('returns the text when it fits and appends … when cut', () => {
    expect(truncateWords('one two three', 40)).toBe('one two three');
    const long = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ');
    const cut = truncateWords(long, 40);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.split(' ').length).toBeLessThanOrEqual(41);
  });
});

describe('spaPathFromStoredUrl', () => {
  it('maps stored /notes paths onto router targets', () => {
    expect(spaPathFromStoredUrl('/notes')).toBe('/');
    expect(spaPathFromStoredUrl('/notes/?category=3')).toBe('/?category=3');
    expect(spaPathFromStoredUrl('/notes/category/3')).toBe('/category/3');
  });

  it('returns null for foreign or missing paths', () => {
    expect(spaPathFromStoredUrl(null)).toBeNull();
    expect(spaPathFromStoredUrl('/tasks/')).toBeNull();
  });
});
