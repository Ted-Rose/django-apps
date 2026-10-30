import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { markdownParagraphSlice } from './markdownPaste';

/**
 * Clipboard text from mobile keyboards, web pages and rich-text
 * editors (Gboard, Google Docs, Word) carries invisible Unicode
 * baggage — non-breaking and fixed-width spaces, zero-width
 * characters, BOMs, directional marks, stray control chars. They
 * render like ordinary text (or nothing at all) but defeat the
 * space-based token matching in the editor's markdown input
 * rules ('# heading', '- list', '> quote'). sanitizeMarkdown-
 * Clipboard normalizes that input once at the paste boundary
 * instead of patching every downstream regex.
 *
 * Char sets are built from code points so no invisible literals
 * ever sit inside this file.
 */
const chars = (...codePoints: number[]): string =>
  String.fromCharCode(...codePoints);

const range = (lo: number, hi: number): string =>
  `${String.fromCharCode(lo)}-${String.fromCharCode(hi)}`;

// Every non-ASCII Unicode space separator (Zs) folds to ' '.
export const UNASCII_SPACES = chars(
  0x00a0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x202f,
  0x205f,
  0x3000,
);
const UNASCII_SPACE_RE = new RegExp(`[${UNASCII_SPACES}]`, 'gu');

// Vertical whitespace keeps line structure: NEL, VT, FF and the
// Unicode line/paragraph separators all become '\n'.
const LINE_SEPARATOR_RE = new RegExp(
  `[${chars(0x0b, 0x0c, 0x85, 0x2028, 0x2029)}]`,
  'gu',
);

// Hidden characters that corrupt token parsing: C0/C1 controls
// (tab and the newline-producing chars above are kept), soft
// hyphen, Arabic letter mark, ZWSP, LRM/RLM, Mongolian vowel
// separator, embedding/override marks, word joiner + invisible
// operators + isolates, and the BOM / zero-width no-break.
const INVISIBLE_CHAR_RE = new RegExp(
  `[${range(0x00, 0x08)}${range(0x0e, 0x1f)}` +
    `${range(0x7f, 0x9f)}` +
    `${chars(0xad, 0x61c, 0x200b, 0x200e, 0x200f)}` +
    `${chars(0x180e, 0xfeff)}${range(0x202a, 0x202e)}` +
    `${range(0x2060, 0x206f)}]`,
  'gu',
);

// ZWNJ/ZWJ are stripped everywhere except where they carry real
// meaning: ZWJ inside emoji sequences (a family emoji falls
// apart without it) and both joiners between letters of cursive
// scripts (Arabic, Mongolian) where they control glyph shaping.
const ZWNJ = chars(0x200c);
const ZWJ = chars(0x200d);
const JOINER_RE = new RegExp(`[${ZWNJ}${ZWJ}]`, 'g');
const EMOJI_PART = new RegExp(
  `[\\p{Extended_Pictographic}${chars(0xfe0f)}]`,
  'u',
);
const CURSIVE_SCRIPT = new RegExp(
  '[\\p{Script=Arabic}\\p{Script=Mongolian}]',
  'u',
);

const prevCodePoint = (s: string, i: number): number | undefined => {
  const cp = s.codePointAt(i - 1);
  return cp !== undefined && cp >= 0xdc00 && cp <= 0xdfff
    ? (s.codePointAt(i - 2) ?? cp)
    : cp;
};

// True when a joiner at s[i] sits between chars that still need
// it — emoji sequence parts (ZWJ) or cursive-script letters.
const joinerHasContext = (ch: string, s: string, i: number): boolean => {
  const prev = prevCodePoint(s, i);
  const next = s.codePointAt(i + 1);
  if (prev === undefined || next === undefined) return false;
  const p = String.fromCodePoint(prev);
  const n = String.fromCodePoint(next);
  if (ch === ZWJ && EMOJI_PART.test(p) && EMOJI_PART.test(n)) {
    return true;
  }
  return CURSIVE_SCRIPT.test(p) && CURSIVE_SCRIPT.test(n);
};

/**
 * Normalizes pasted clipboard text: every Unicode space variant
 * becomes ' ', line/paragraph separators become '\n', and
 * zero-width/directional/control characters are stripped.
 * Line and paragraph structure is preserved.
 */
export const sanitizeMarkdownClipboard = (rawText: string): string =>
  rawText
    .replace(/\r\n?/g, '\n')
    .replace(LINE_SEPARATOR_RE, '\n')
    .replace(UNASCII_SPACE_RE, ' ')
    .replace(INVISIBLE_CHAR_RE, '')
    .replace(JOINER_RE, (ch, offset, s) =>
      joinerHasContext(ch, s, offset) ? ch : '',
    );

const sanitizeFragment = (
  fragment: Fragment,
  inCode: boolean,
  parentName = '',
): Fragment => {
  const nodes: PMNode[] = [];
  fragment.forEach((node) => {
    if (node.isText) {
      const verbatim = inCode || node.marks.some((m) => m.type.spec.code);
      const text = node.text ?? '';
      const clean = verbatim ? text : sanitizeMarkdownClipboard(text);
      if (clean === text) {
        nodes.push(node);
      } else if (clean) {
        nodes.push(node.type.schema.text(clean, node.marks));
      }
      return;
    }
    nodes.push(
      node.type.schema.node(
        node.type,
        node.attrs,
        sanitizeFragment(
          node.content,
          inCode || !!node.type.spec.code,
          node.type.name,
        ),
        node.marks,
      ),
    );
  });
  return Fragment.fromArray(mergeSiblingLists(nodes, parentName));
};

const isList = (node: PMNode): boolean =>
  node.type.name === 'bulletList' || node.type.name === 'orderedList';

// Rejoin same-kind lists that clipboard HTML splits into one
// <ul>/<ol> per item — the rendered blank lines between them
// arrive as empty paragraphs. A spacer paragraph is only
// dropped when it sits between two lists of the same type, and
// non-empty paragraphs still keep lists apart.
const mergeSiblingLists = (nodes: PMNode[], parentName: string): PMNode[] => {
  const out: PMNode[] = [];
  for (const node of nodes) {
    if (isList(node)) {
      let k = out.length - 1;
      while (
        k >= 0 &&
        out[k].type.name === 'paragraph' &&
        !out[k].textContent.trim()
      ) {
        k -= 1;
      }
      const target = out[k];
      if (target && target.type.name === node.type.name) {
        out.length = k + 1;
        out[k] = target.copy(target.content.append(node.content));
        continue;
      }
    }
    out.push(node);
  }
  // Inside lists, empty nodes are rendered blank lines between
  // the source's items ('<li><br></li>' and '<p><br></p>'
  // artifacts) — drop them while real content survives.
  const insideList =
    parentName === 'listItem' ||
    parentName === 'bulletList' ||
    parentName === 'orderedList';
  if (insideList && out.some((node) => node.textContent.trim())) {
    return out.filter((node) => isList(node) || node.textContent.trim());
  }
  return out;
};

// Block types whose open slice edge must be closed before
// insert: ProseMirror re-opens boundaries via Slice.maxOpen,
// which merges a pasted heading or list into the paragraph under
// the cursor and loses the structure entirely. Paragraph and
// inline edges stay open so plain pasted lines keep merging
// into the surrounding text naturally.
const STRUCTURAL_BLOCKS = new Set([
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'listItem',
  'horizontalRule',
]);

const structuralEdge = (node: PMNode | null | undefined) =>
  !!node && STRUCTURAL_BLOCKS.has(node.type.name);

/**
 * Normalizes every text node inside a pasted slice — needed
 * because transformPastedText only runs for plain-text pastes:
 * HTML clipboard content (Google Docs, Word) and editor-internal
 * drags arrive as parsed slices. Text inside code blocks and
 * inline code marks is left verbatim — spacing is significant
 * there. Structural edge nodes get closed boundaries (above).
 */
export const sanitizePastedSlice = (slice: Slice): Slice =>
  new Slice(
    sanitizeFragment(slice.content, false),
    structuralEdge(slice.content.firstChild) ? 0 : slice.openStart,
    structuralEdge(slice.content.lastChild) ? 0 : slice.openEnd,
  );

// Mirrors ProseMirror's own inCode check ($context.parent): the
// clipboard lands verbatim inside code blocks.
const inCodeContext = (view: EditorView): boolean =>
  !!view.state.selection.$from.parent.type.spec.code;

/**
 * EditorProps.transformPastedText — normalizes the text/plain
 * clipboard payload before ProseMirror parses it into blocks.
 */
export const transformPastedText = (
  text: string,
  _plain: boolean,
  view: EditorView,
): string => (inCodeContext(view) ? text : sanitizeMarkdownClipboard(text));

/**
 * EditorProps.transformPasted — catches what the text path
 * misses: HTML pastes and internal drags both arrive as slices.
 */
const transformPastedSliceImpl = (slice: Slice, view: EditorView): Slice => {
  if (inCodeContext(view)) return slice;
  const clean = sanitizePastedSlice(slice);
  // Rich-text clipboards can carry raw markdown as literal
  // paragraph text — reparse block structure from it.
  return markdownParagraphSlice(clean, view) ?? clean;
};

export { transformPastedSliceImpl as transformPastedSlice };
