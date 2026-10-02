/* eslint-disable i18next/no-literal-string -- Latvian-only toy page,
   no catalogs (see docs/plans/SINGLE_PAGES_REACT_REWRITE.md). */

interface FieldListProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}

/**
 * Labeled dynamic string-list — the twister.html addField() helper
 * (plus a per-row remove button) as controlled string[] state.
 * Empty rows are dropped by the caller when the game starts — the
 * template's removeEmptyFields() parity.
 */
export default function FieldList({ label, values, onChange }: FieldListProps) {
  const setValue = (index: number, value: string) =>
    onChange(values.map((v, i) => (i === index ? value : v)));
  const addField = () => onChange([...values, '']);
  const removeField = (index: number) =>
    onChange(values.filter((_, i) => i !== index));

  return (
    <div className="field-list">
      <div className="field-list-label">{label}</div>
      {values.map((value, index) => (
        // Index keys are fine — rows are plain text inputs whose
        // order only changes via add/remove at the ends.
        <div className="field-row" key={index}>
          <input
            type="text"
            aria-label={`${label} ${index + 1}`}
            value={value}
            onChange={(e) => setValue(index, e.target.value)}
          />
          <button
            type="button"
            className="field-remove"
            aria-label={`Remove ${label} ${index + 1}`}
            onClick={() => removeField(index)}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" onClick={addField}>
        Pievienot lauku
      </button>
    </div>
  );
}
