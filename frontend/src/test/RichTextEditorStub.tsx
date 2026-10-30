import type { ComponentProps } from 'react';
import type RichTextEditor from '../shared/components/RichTextEditor';

type Props = ComponentProps<typeof RichTextEditor>;

/**
 * Test double for the TipTap-backed RichTextEditor — jsdom can't
 * drive a ProseMirror contenteditable through fireEvent, so route
 * tests mock the module with this plain textarea that keeps the
 * same value/onChange contract. `aria-label` mirrors the real
 * component so getByLabelText queries resolve identically.
 */
export function RichTextEditorStub({
  value,
  onChange,
  ariaLabel,
  id,
  placeholder,
  disabled,
}: Props) {
  return (
    <textarea
      id={id}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default RichTextEditorStub;
