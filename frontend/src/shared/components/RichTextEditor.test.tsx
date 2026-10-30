import React, { createRef } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { EditorView } from '@tiptap/pm/view';
import RichTextEditor from './RichTextEditor';
import type { RichTextEditorHandle } from './RichTextEditor';
import { isTiptapDocString } from '../tiptapContent';

const renderEditor = (ui: React.ReactElement) => render(ui);

describe('RichTextEditor', () => {
  it('mounts with toolbar and editable content', () => {
    const { container } = renderEditor(
      <RichTextEditor value="" onChange={vi.fn()} />,
    );
    expect(container.querySelector('.ProseMirror')).toBeTruthy();
    expect(screen.getByRole('button', { name: /bold/i })).toBeInTheDocument();
    expect(
      container
        .querySelector<HTMLElement>('.ProseMirror')
        ?.getAttribute('contenteditable'),
    ).toBe('true');
  });

  it('loads legacy plain text without parsing markup', async () => {
    renderEditor(
      <RichTextEditor
        value={'a < b & "quotes"\nsecond line'}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(document.body.textContent).toContain('a < b & "quotes"');
      expect(document.body.textContent).toContain('second line');
    });
  });

  it('loads legacy markdown as document structure', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(
      <RichTextEditor
        ref={ref}
        value={'# Stored heading\n\n- one\n- two'}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const content = ref.current?.editor?.getJSON().content ?? [];
    expect(content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
    expect(content[1]?.type).toBe('bulletList');
  });

  it('loads stored doc-JSON verbatim', async () => {
    const savedRun = {
      type: 'text',
      text: 'saved',
      marks: [{ type: 'bold' }],
    };
    const stored = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [savedRun] }],
    });
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(
      <RichTextEditor ref={ref} value={stored} onChange={vi.fn()} />,
    );
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const json = JSON.stringify(ref.current?.editor?.getJSON());
    expect(json).toContain('bold');
    expect(ref.current?.editor?.getText()).toBe('saved');
  });

  it('emits doc-JSON on change', async () => {
    const onChange = vi.fn();
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={onChange} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    ref.current?.editor?.commands.insertContent('hello');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitted = onChange.mock.calls.at(-1)?.[0] as string;
    expect(isTiptapDocString(emitted)).toBe(true);
    expect(emitted).toContain('hello');
  });

  it('grows up to 60vh then scrolls internally', () => {
    const { container } = renderEditor(
      <RichTextEditor value="" onChange={vi.fn()} />,
    );
    const proseMirror = container.querySelector<HTMLElement>('.ProseMirror');
    expect(proseMirror?.style.maxHeight).toBe('60vh');
    expect(proseMirror?.style.overflowY).toBe('auto');
  });

  it('doubles as a read-only renderer when disabled', () => {
    const { container } = renderEditor(
      <RichTextEditor value="locked" onChange={vi.fn()} disabled />,
    );
    expect(
      container
        .querySelector<HTMLElement>('.ProseMirror')
        ?.getAttribute('contenteditable'),
    ).toBe('false');
    expect(
      screen.queryByRole('button', { name: /bold/i }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).toContain('locked');
  });

  // jsdom has no ClipboardEvent constructor; doPaste only
  // forwards it to a handlePaste prop we don't define.
  const pasteEvent = {} as ClipboardEvent;

  it('normalizes unicode whitespace pasted as plain text', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const nbsp = String.fromCharCode(0xa0);
    const zwsp = String.fromCharCode(0x200b);
    ref.current?.editor?.view.pasteText(`#${nbsp}head${zwsp}ing`, pasteEvent);
    // '# heading' normalizes, then parses as markdown → h1.
    const doc = ref.current?.editor?.getJSON().content ?? [];
    expect(doc[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
    expect(ref.current?.editor?.getText()).toBe('heading');
  });

  it('normalizes whitespace pasted as HTML', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    ref.current?.editor?.view.pasteHTML(
      '<p>one&nbsp;two&#8203;three</p>',
      pasteEvent,
    );
    expect(ref.current?.editor?.getText()).toBe('one twothree');
  });

  it('keeps pasted text verbatim inside code blocks', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    editor?.commands.setContent('<pre><code>let x</code></pre>');
    editor?.commands.setTextSelection(3);
    const nbsp = String.fromCharCode(0xa0);
    editor?.view.pasteText(`a${nbsp}b`, pasteEvent);
    expect(editor?.getText()).toContain(`a${nbsp}b`);
  });

  // A real 'paste' DOM event exercising the production path
  // (pasteText() forces preferPlain — either way markdown
  // conversion runs, but this matches what a browser does).
  const firePaste = (view: EditorView, text: string) => {
    const event = new Event('paste');
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    });
    view.dom.dispatchEvent(event);
  };

  it('converts block-level markdown pasted as plain text', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    if (!editor) return;
    firePaste(
      editor.view,
      [
        '# The Five Levitical Offerings',
        '',
        '---',
        '',
        '## 1. The Burnt Offering (*Olah*)',
        '',
        '- **Leviticus Reference:** @LEV.1.1-17',
        '- **Core Meaning:** surrender',
        '  - @LUK.9.62',
        '',
        '> a quote',
        '',
        '1. first',
        '2. second',
      ].join('\n'),
    );
    const content = editor?.getJSON().content ?? [];
    const types = content.map((n) => n.type);
    // The last entry is the paragraph the paste happened in.
    expect(types.slice(0, 6)).toEqual([
      'heading',
      'horizontalRule',
      'heading',
      'bulletList',
      'blockquote',
      'orderedList',
    ]);
    // The first heading must keep its type — an open slice edge
    // would merge it into the cursor's paragraph as plain text.
    expect(content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
    expect(content[2]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
    });
    // Nested '  - @LUK.9.62' indents into a child bullet list.
    const items = content[3].content ?? [];
    const hasNestedList = items.some((item) =>
      (item.content ?? []).some((n) => n.type === 'bulletList'),
    );
    expect(hasNestedList).toBe(true);
    // Inline marks resolve inside markdown blocks —
    // '**Leviticus Reference:**' in the first item goes bold.
    expect(JSON.stringify(content[3])).toContain('"bold"');
  });

  it('keeps a pasted HTML heading as a heading node', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    editor?.view.pasteHTML('<h1>Title</h1><p>body</p>', pasteEvent);
    // Without the edge clamp the open slice boundary merges the
    // h1's text into the cursor paragraph — heading lost.
    const content = editor?.getJSON().content ?? [];
    expect(content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
  });

  it('keeps blank-line-separated items in one loose list', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    if (!editor) return;
    firePaste(
      editor.view,
      [
        '1. The Burnt Offering',
        '- Leviticus Reference: @LEV.1.1-17',
        '',
        '- Core Meaning: surrender',
        '',
        '- Scriptural Connections:',
        '',
        '  - @LUK.9.62',
        '  - @ROM.12.1',
      ].join('\n'),
    );
    const content = editor.getJSON().content ?? [];
    // '1.' and '- ' can't share a list — the bullet items must
    // form ONE list (blank lines don't split it), nested under
    // 'Scriptural Connections:'.
    const types = content.map((n) => n.type);
    expect(types.slice(0, 2)).toEqual(['orderedList', 'bulletList']);
    const items = content[1].content ?? [];
    expect(items).toHaveLength(3);
    const nested = items[2].content?.find((n) => n.type === 'bulletList');
    expect(nested?.content).toHaveLength(2);
  });

  it('merges fragmented HTML lists split by blank lines', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    // Rich-text sources emit one <ul> per item plus an empty
    // <p> where the source markdown had a blank line.
    editor?.view.pasteHTML(
      '<ul><li>one</li></ul>' +
        '<p></p>' +
        '<ul><li>two</li><li>three</li></ul>',
      pasteEvent,
    );
    const content = editor?.getJSON().content ?? [];
    const lists = content.filter((n) => n.type === 'bulletList');
    expect(lists).toHaveLength(1);
    expect(lists[0].content).toHaveLength(3);
  });

  it('reparses raw markdown text pasted inside HTML', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    // A source showing raw markdown serializes it as HTML text:
    // block markers arrive inside <div>/<p> with <br> spacers
    // and clipboardTextParser is skipped entirely.
    editor?.view.pasteHTML(
      '<div>## Section</div>' +
        '<div>- one</div>' +
        '<div><br></div>' +
        '<div>- two</div>',
      pasteEvent,
    );
    const content = editor?.getJSON().content ?? [];
    expect(
      content.some((n) => n.type === 'heading' && n.attrs?.level === 2),
    ).toBe(true);
    const lists = content.filter((n) => n.type === 'bulletList');
    expect(lists).toHaveLength(1);
    expect(lists[0].content).toHaveLength(2);
  });

  it('does NOT reparse rich text that carries real marks', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    // A bold '- item' inside a <p> is real rich text — the mark
    // vetoes the markdown reparse so it stays literal text.
    editor?.view.pasteHTML('<p><strong>- not a list</strong></p>', pasteEvent);
    const content = editor?.getJSON().content ?? [];
    expect(content.every((n) => n.type === 'paragraph')).toBe(true);
    expect(editor?.getText()).toContain('- not a list');
  });

  it('drops blank-line artifacts inside pasted HTML lists', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    editor?.view.pasteHTML(
      '<ul><li>one</li><li><br></li>' + '<li>two<p></p></li></ul>',
      pasteEvent,
    );
    const lists = (editor?.getJSON().content ?? []).filter(
      (n) => n.type === 'bulletList',
    );
    expect(lists).toHaveLength(1);
    const items = lists[0].content ?? [];
    expect(items).toHaveLength(2);
    // The empty trailing <p> inside item two must not survive
    // as a rendered blank line.
    const itemChildren = items[1].content ?? [];
    expect(
      itemChildren.every(
        (n) => n.type !== 'paragraph' || (n.content?.length ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it('parses bullet glyphs pasted from rich text apps', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    if (!editor) return;
    // Word/Outlook put '•' on text/plain instead of '-'.
    firePaste(editor.view, '• one\n• two');
    const lists = (editor?.getJSON().content ?? []).filter(
      (n) => n.type === 'bulletList',
    );
    expect(lists).toHaveLength(1);
    expect(lists[0].content).toHaveLength(2);
  });

  it('leaves prose without markdown tokens untouched', async () => {
    const ref = createRef<RichTextEditorHandle>();
    renderEditor(<RichTextEditor ref={ref} value="" onChange={vi.fn()} />);
    await waitFor(() => expect(ref.current?.editor).toBeTruthy());
    const editor = ref.current?.editor;
    editor?.view.pasteText('just #tag and a - dash\nsecond line', pasteEvent);
    const content = editor?.getJSON().content ?? [];
    expect(content.every((n) => n.type === 'paragraph')).toBe(true);
    expect(editor?.getText()).toContain('#tag and a - dash');
  });
});
