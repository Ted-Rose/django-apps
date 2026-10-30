import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { markdownTextToDocJSON } from './markdownPaste';
import type { JSONContent } from '@tiptap/core';

// Same extension set the editor schema is built from — mark and
// node names must resolve identically in tests.
const schema = getSchema([
  StarterKit,
  Underline,
  Link.configure({ protocols: ['http', 'https', 'mailto'] }),
]);

const doc = (text: string): JSONContent[] =>
  markdownTextToDocJSON(schema, text).content ?? [];

const types = (nodes: JSONContent[]) => nodes.map((n) => n.type);

describe('markdownTextToDocJSON — blocks', () => {
  it('parses headings, a rule and a blockquote run', () => {
    const nodes = doc('# Title\n\n---\n\n## Sub\n\n> one\n> two');
    expect(types(nodes)).toEqual([
      'heading',
      'horizontalRule',
      'heading',
      'blockquote',
    ]);
    expect(nodes[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
    expect(nodes[2]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
    });
    // Each '>' line becomes a paragraph inside one blockquote.
    expect(nodes[3].content).toHaveLength(2);
  });

  it('parses fenced code with a language, verbatim', () => {
    const nodes = doc('```py\nx = "# not a heading"\n```');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: 'codeBlock',
      attrs: { language: 'py' },
    });
    expect(nodes[0].content?.[0].text).toBe('x = "# not a heading"');
  });

  it('parses Word/Outlook bullet glyphs as list items', () => {
    const nodes = doc('• one\n◦ two\n▪ three');
    expect(types(nodes)).toEqual(['bulletList']);
    expect(nodes[0].content).toHaveLength(3);
  });

  it('keeps ordered list start numbers and the ")" form', () => {
    const nodes = doc('3) three\n4) four');
    expect(nodes[0]).toMatchObject({
      type: 'orderedList',
      attrs: { start: 3 },
    });
    expect(nodes[0].content).toHaveLength(2);
  });

  it('nests a sub-list under the previous item', () => {
    const nodes = doc('- a\n  - a1\n- b');
    const items = nodes[0].content ?? [];
    expect(items).toHaveLength(2);
    const nested = items[0].content?.find((n) => n.type === 'bulletList');
    expect(nested?.content).toHaveLength(1);
  });

  it('opens a sibling list on a marker-type switch', () => {
    // '1.' then '- ' at depth 0 can't share a list — the bullet
    // items form a second root list, not list items.
    const nodes = doc('1. first\n- bullet\n- bullet2');
    expect(types(nodes)).toEqual(['orderedList', 'bulletList']);
    expect(nodes[1].content).toHaveLength(2);
  });

  it('keeps blank-line-separated items in one loose list', () => {
    const nodes = doc('- one\n\n- two\n\n- three');
    expect(types(nodes)).toEqual(['bulletList']);
    expect(nodes[0].content).toHaveLength(3);
  });

  it('continues the previous item on an indented line', () => {
    const nodes = doc('- first line\n  continued here\n- second');
    const items = nodes[0].content ?? [];
    expect(items).toHaveLength(2);
    expect(items[0].content?.[0].content?.[0].text).toBe(
      'first line continued here',
    );
  });

  it('leaves prose without block tokens as paragraphs', () => {
    const nodes = doc('just #tag and a - dash\nsecond line');
    expect(types(nodes)).toEqual(['paragraph', 'paragraph']);
    expect(nodes[0].content?.[0].text).toBe('just #tag and a - dash');
  });
});

describe('markdownTextToDocJSON — inline marks', () => {
  const marksOf = (node: JSONContent) => (node.marks ?? []).map((m) => m.type);

  it('resolves bold, italic, strike and code spans', () => {
    const nodes = doc('a **b** and *i* plus ~~s~~ and `c`');
    const runs = nodes[0].content ?? [];
    const byType = (type: string) =>
      runs.find((r) => marksOf(r).includes(type));
    expect(byType('bold')?.text).toBe('b');
    expect(byType('italic')?.text).toBe('i');
    expect(byType('strike')?.text).toBe('s');
    expect(byType('code')?.text).toBe('c');
  });

  it('nests marks inside strong', () => {
    const nodes = doc('**bold _and italic_**');
    const run = (nodes[0].content ?? []).find((r) =>
      marksOf(r).includes('italic'),
    );
    expect(run?.text).toBe('and italic');
    expect(marksOf(run ?? {})).toEqual(
      expect.arrayContaining(['bold', 'italic']),
    );
  });

  it('parses links', () => {
    const nodes = doc('see [the docs](https://example.com)');
    const run = (nodes[0].content ?? []).find((r) =>
      marksOf(r).includes('link'),
    );
    expect(run?.text).toBe('the docs');
    expect(run?.marks?.[0].attrs?.href).toBe('https://example.com');
  });

  it('keeps intraword underscores literal', () => {
    const nodes = doc('snake_case_name stays');
    const runs = nodes[0].content ?? [];
    expect(runs.every((r) => marksOf(r).length === 0)).toBe(true);
  });

  it('keeps unclosed delimiters literal', () => {
    const nodes = doc('a * b and c ** d');
    const runs = nodes[0].content ?? [];
    expect(runs.every((r) => marksOf(r).length === 0)).toBe(true);
  });

  it('applies inline marks inside list items and quotes', () => {
    const nodes = doc('- **Priority:** high\n\n> a *quoted* line');
    const item = nodes[0].content?.[0].content?.[0];
    const bold = item?.content?.find((r) => marksOf(r).includes('bold'));
    expect(bold?.text).toBe('Priority:');
    const quote = nodes[1].content?.[0].content?.find((r) =>
      marksOf(r).includes('italic'),
    );
    expect(quote?.text).toBe('quoted');
  });
});
