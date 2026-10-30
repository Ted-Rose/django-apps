import { describe, it, expect } from 'vitest';
import { sanitizeMarkdownClipboard } from './clipboardSanitize';
import { UNASCII_SPACES } from './clipboardSanitize';

const chr = String.fromCharCode;
const NBSP = chr(0xa0);
const ZWSP = chr(0x200b);
const ZWNJ = chr(0x200c);
const ZWJ = chr(0x200d);
const BOM = chr(0xfeff);

describe('sanitizeMarkdownClipboard', () => {
  it('leaves ordinary text untouched', () => {
    const text =
      'A normal note with spaces, tabs\tand ' +
      'newlines\nacross paragraphs.\n\nSecond paragraph.';
    expect(sanitizeMarkdownClipboard(text)).toBe(text);
  });

  it('folds every non-ASCII Unicode space to ASCII space', () => {
    for (const space of UNASCII_SPACES) {
      expect(sanitizeMarkdownClipboard(`a${space}b`)).toBe('a b');
    }
    expect(UNASCII_SPACES).toContain(NBSP);
    expect(UNASCII_SPACES).toContain(chr(0x2002));
    expect(UNASCII_SPACES).toContain(chr(0x2003));
    expect(UNASCII_SPACES).toContain(chr(0x2009));
    expect(UNASCII_SPACES).toContain(chr(0x3000));
  });

  it('normalizes markdown tokens separated by weird spaces', () => {
    expect(sanitizeMarkdownClipboard(`#${NBSP}Heading`)).toBe('# Heading');
    expect(sanitizeMarkdownClipboard(`-${chr(0x2003)}item`)).toBe('- item');
    expect(sanitizeMarkdownClipboard(`>${chr(0x3000)}quote`)).toBe('> quote');
    expect(sanitizeMarkdownClipboard(`1.${chr(0x202f)}item`)).toBe('1. item');
    expect(sanitizeMarkdownClipboard(`*${chr(0x2009)}item`)).toBe('* item');
  });

  it('strips zero-width and byte-order characters', () => {
    expect(sanitizeMarkdownClipboard(`a${ZWSP}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${ZWNJ}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${ZWJ}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`${BOM}a${BOM}b`)).toBe('ab');
    // WORD JOINER
    expect(sanitizeMarkdownClipboard(`a${chr(0x2060)}b`)).toBe('ab');
  });

  it('strips directional formatting characters', () => {
    // LRM, RLM
    expect(sanitizeMarkdownClipboard(`a${chr(0x200e)}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${chr(0x200f)}b`)).toBe('ab');
    // LRE..PDF embeddings/overrides
    expect(sanitizeMarkdownClipboard(`a${chr(0x202a)}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${chr(0x202e)}b`)).toBe('ab');
    // Directional isolates + Arabic letter mark
    expect(sanitizeMarkdownClipboard(`a${chr(0x2066)}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${chr(0x061c)}b`)).toBe('ab');
  });

  it('strips control characters but keeps tab and newline', () => {
    expect(sanitizeMarkdownClipboard(`a${chr(0x00)}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${chr(0x08)}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${chr(0x1f)}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${chr(0x7f)}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`a${chr(0x9f)}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard('a\tb\nc')).toBe('a\tb\nc');
  });

  it('turns line separators into real newlines', () => {
    // LINE SEPARATOR, PARAGRAPH SEPARATOR, NEL, VT, FF
    for (const sep of [0x2028, 0x2029, 0x85, 0x0b, 0x0c]) {
      expect(sanitizeMarkdownClipboard(`a${chr(sep)}b`)).toBe('a\nb');
    }
    // CRLF / CR normalize too
    expect(sanitizeMarkdownClipboard('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('keeps ZWJ inside emoji sequences', () => {
    const family = '👨‍👩‍👧';
    expect(sanitizeMarkdownClipboard(family)).toBe(family);
    const rainbow = '🏳️‍🌈';
    expect(sanitizeMarkdownClipboard(rainbow)).toBe(rainbow);
  });

  it('strips a stray ZWJ that is not part of an emoji', () => {
    expect(sanitizeMarkdownClipboard(`a${ZWJ}b`)).toBe('ab');
    expect(sanitizeMarkdownClipboard(`${ZWJ}a`)).toBe('a');
    expect(sanitizeMarkdownClipboard(`a${ZWJ}`)).toBe('a');
  });

  it('keeps joiners between Arabic-script letters', () => {
    const arabic = `م${ZWNJ}ی`;
    expect(sanitizeMarkdownClipboard(arabic)).toBe(arabic);
  });

  it('normalizes a realistic pasted note end-to-end', () => {
    const pasted =
      `#${NBSP}My${ZWSP}Heading\n` +
      `-${chr(0x2002)}first${chr(0x200b)}item\n` +
      `>${chr(0x3000)}a quote${chr(0x2028)}` +
      `second line${BOM}`;
    expect(sanitizeMarkdownClipboard(pasted)).toBe(
      '# MyHeading\n- firstitem\n> a quote\nsecond line',
    );
  });

  it('is idempotent', () => {
    const messy =
      `#${NBSP}H${ZWSP}\n` + `-${chr(0x2007)}i${chr(0x2028)}x${BOM}y`;
    const once = sanitizeMarkdownClipboard(messy);
    expect(sanitizeMarkdownClipboard(once)).toBe(once);
  });
});
