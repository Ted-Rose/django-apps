import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorContent, useEditor } from '@tiptap/react';
import { getSchema } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  transformPastedSlice,
  transformPastedText,
} from '../clipboardSanitize';
import {
  markdownClipboardParser,
  markdownTextToDocJSON,
} from '../markdownPaste';
import { isTiptapDocString } from '../tiptapContent';
import './RichTextEditor.css';

interface RichTextEditorProps {
  /** Doc-JSON string or legacy plain text (markdown-parsed). */
  value: string;
  /** Emits JSON.stringify(editor.getJSON()). */
  onChange: (value: string) => void;
  /** 'default' grows from a few lines; 'compact' stays shorter. */
  variant?: 'default' | 'compact';
  autoFocus?: boolean;
  placeholder?: string;
  label?: string;
  /** Accessible name for the contenteditable region. */
  ariaLabel?: string;
  id?: string;
  disabled?: boolean;
}

const SCHEMA_EXTENSIONS = [
  StarterKit,
  Underline,
  Link.configure({
    autolink: false,
    linkOnPaste: false,
    openOnClick: false,
    protocols: ['http', 'https', 'mailto'],
  }),
];

// Headless schema for the legacy-text → doc-JSON conversion that
// runs before an editor instance exists.
const LOAD_SCHEMA = getSchema(SCHEMA_EXTENSIONS);

// Legacy plain text loads as escaped text — a '<' in old notes
// must never parse as markup. Markdown structure in stored notes
// (Google Tasks bodies are hand-written markdown sometimes)
// becomes real document structure.
const valueToContent = (value: string) => {
  if (!value) return '';
  if (isTiptapDocString(value)) return JSON.parse(value);
  return markdownTextToDocJSON(LOAD_SCHEMA, value);
};

export interface RichTextEditorHandle {
  editor: Editor | null;
}

interface ToolbarButton {
  key: string;
  icon: string;
  labelKey: string;
  active?: string;
  attrs?: Record<string, unknown>;
  run: (editor: Editor) => void;
}

const BUTTON_GROUPS: ToolbarButton[][] = [
  [
    {
      key: 'bold',
      icon: 'bi-type-bold',
      labelKey: 'editor.bold',
      active: 'bold',
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      icon: 'bi-type-italic',
      labelKey: 'editor.italic',
      active: 'italic',
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      key: 'underline',
      icon: 'bi-type-underline',
      labelKey: 'editor.underline',
      active: 'underline',
      run: (e) => e.chain().focus().toggleUnderline().run(),
    },
    {
      key: 'strike',
      icon: 'bi-type-strikethrough',
      labelKey: 'editor.strike',
      active: 'strike',
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
  ],
  [
    {
      key: 'h1',
      icon: 'bi-type-h1',
      labelKey: 'editor.heading1',
      active: 'heading',
      attrs: { level: 1 },
      run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      key: 'h2',
      icon: 'bi-type-h2',
      labelKey: 'editor.heading2',
      active: 'heading',
      attrs: { level: 2 },
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'h3',
      icon: 'bi-type-h3',
      labelKey: 'editor.heading3',
      active: 'heading',
      attrs: { level: 3 },
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ],
  [
    {
      key: 'bulletList',
      icon: 'bi-list-ul',
      labelKey: 'editor.bulletList',
      active: 'bulletList',
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'orderedList',
      icon: 'bi-list-ol',
      labelKey: 'editor.orderedList',
      active: 'orderedList',
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
  ],
  [
    {
      key: 'blockquote',
      icon: 'bi-blockquote-left',
      labelKey: 'editor.blockquote',
      active: 'blockquote',
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      key: 'codeBlock',
      icon: 'bi-code-square',
      labelKey: 'editor.codeBlock',
      active: 'codeBlock',
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
  ],
];

const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
      value,
      onChange,
      variant = 'default',
      autoFocus = false,
      placeholder,
      label,
      ariaLabel,
      id,
      disabled = false,
    },
    ref,
  ) {
    const { t } = useTranslation();
    // Last string this editor emitted — distinguishes external
    // value changes (reload/reset) from the editor's own edits.
    const lastEmitted = useRef<string | null>(null);

    const editor = useEditor({
      extensions: [
        ...SCHEMA_EXTENSIONS,
        Placeholder.configure({ placeholder: placeholder ?? '' }),
      ],
      content: valueToContent(value),
      autofocus: autoFocus ? 'end' : false,
      editable: !disabled,
      // The editor grows with content up to 60% of the viewport
      // height, then scrolls internally — the page never jumps.
      editorProps: {
        // Pasted clipboard text (mobile keyboards, Docs, Word)
        // carries NBSPs/zero-width chars that break '#'/'-'/'>'
        // token matching — normalize at the paste boundary. Both
        // paths are needed: transformPastedText only runs for
        // plain-text pastes; HTML pastes arrive as parsed slices.
        transformPastedText,
        transformPasted: transformPastedSlice,
        // TipTap paste rules only convert marks; block-level
        // markdown ('#', '-', '>', '---') is parsed here so pasted
        // notes keep their structure.
        clipboardTextParser: markdownClipboardParser,
        attributes: {
          ...(id ? { id } : {}),
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': ariaLabel ?? label ?? '',
          style:
            `min-height: ${variant === 'compact' ? '2.5em' : '6em'};` +
            ' max-height: 60vh; overflow-y: auto;',
        },
      },
      onUpdate: ({ editor: e }) => {
        const json = JSON.stringify(e.getJSON());
        lastEmitted.current = json;
        onChange(json);
      },
    });

    useImperativeHandle(ref, () => ({ editor }), [editor]);

    // External value changes (form reset, loading another record)
    // replace the doc; the editor's own emissions skip this.
    useEffect(() => {
      if (!editor) return;
      if (value === lastEmitted.current) return;
      if (value === JSON.stringify(editor.getJSON())) return;
      editor.commands.setContent(valueToContent(value));
      lastEmitted.current = value;
    }, [value, editor]);

    useEffect(() => {
      editor?.setEditable(!disabled);
    }, [editor, disabled]);

    const promptLink = () => {
      if (!editor) return;
      const previous = (editor.getAttributes('link').href as string) || '';
      const href = window.prompt(t('editor.linkPrompt'), previous);
      if (href === null) return;
      if (!href.trim()) {
        editor.chain().focus().unsetLink().run();
      } else {
        editor
          .chain()
          .focus()
          .extendMarkRange('link')
          .setLink({ href: href.trim() })
          .run();
      }
    };

    return (
      <div className={`rte${disabled ? ' rte-disabled' : ''}`}>
        {label && (
          <label className="form-label" htmlFor={id}>
            {label}
          </label>
        )}
        <div className="rte-box">
          {!disabled && (
            <div className="rte-toolbar" role="toolbar">
              {BUTTON_GROUPS.map((group, gi) => (
                <div
                  className="btn-group btn-group-sm me-1"
                  role="group"
                  key={gi}
                >
                  {group.map((btn) => (
                    <button
                      type="button"
                      key={btn.key}
                      className={
                        'btn btn-outline-secondary rte-btn' +
                        (editor?.isActive(btn.active ?? btn.key, btn.attrs)
                          ? ' active'
                          : '')
                      }
                      title={t(btn.labelKey)}
                      aria-label={t(btn.labelKey)}
                      aria-pressed={
                        editor?.isActive(btn.active ?? btn.key, btn.attrs)
                          ? true
                          : undefined
                      }
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => editor && btn.run(editor)}
                    >
                      <i className={`bi ${btn.icon}`} />
                    </button>
                  ))}
                </div>
              ))}
              <div className="btn-group btn-group-sm me-1" role="group">
                <button
                  type="button"
                  className={
                    'btn btn-outline-secondary rte-btn' +
                    (editor?.isActive('link') ? ' active' : '')
                  }
                  title={t('editor.link')}
                  aria-label={t('editor.link')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={promptLink}
                >
                  <i className="bi bi-link-45deg" />
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary rte-btn"
                  title={t('editor.unlink')}
                  aria-label={t('editor.unlink')}
                  disabled={!editor?.isActive('link')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => editor?.chain().focus().unsetLink().run()}
                >
                  <i className="bi bi-link-45deg rte-strike-icon" />
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary rte-btn"
                  title={t('editor.clearFormatting')}
                  aria-label={t('editor.clearFormatting')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    editor?.chain().focus().unsetAllMarks().clearNodes().run()
                  }
                >
                  <i className="bi bi-eraser" />
                </button>
              </div>
            </div>
          )}
          <EditorContent editor={editor} />
        </div>
      </div>
    );
  },
);

export default RichTextEditor;
