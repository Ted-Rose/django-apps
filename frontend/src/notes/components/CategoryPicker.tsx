import { useTranslation } from 'react-i18next';
import type { NoteCategoryOut } from '../api';
import { flattenCategoryTree } from '../categories';

/**
 * The category tree picker — a button-list of the tree flattened
 * to arbitrary depth (each level indents a step) plus an
 * Uncategorized row and, for the editor, a "Not a note" escape
 * that converts the note back into a plain task (is_note: false
 * on PATCH).
 *
 * Selection values: `null` = Uncategorized (sent as category_id:
 * null), a category id, or the NOT_A_NOTE sentinel — kept as a
 * string union so callers can pass the value through <select>-like
 * semantics without parsing.
 */
export const NOT_A_NOTE = 'not-a-note' as const;
export type CategorySelection = number | null | typeof NOT_A_NOTE;

interface CategoryPickerProps {
  categories: NoteCategoryOut[];
  /** Current selection (category id, null for uncategorized,
   *  NOT_A_NOTE for the convert-to-task escape). */
  value: CategorySelection;
  /** Show the "Not a note" escape row (editor only). */
  allowNotANote?: boolean;
  onChange: (selection: CategorySelection) => void;
}

export function CategoryPicker({
  categories,
  value,
  allowNotANote = false,
  onChange,
}: CategoryPickerProps) {
  const { t } = useTranslation('notes');
  const rows = flattenCategoryTree(categories);

  const optionClass = (selected: boolean) =>
    `category-picker-option${selected ? ' selected' : ''}`;

  return (
    <div role="listbox" aria-label={t('picker.title')}>
      <button
        type="button"
        role="option"
        aria-selected={value === null}
        className={optionClass(value === null)}
        onClick={() => onChange(null)}
      >
        <i className="bi bi-inbox" /> {t('picker.uncategorized')}
      </button>
      {rows.map(({ category, depth, hasChildren }) => (
        <button
          key={category.id}
          type="button"
          role="option"
          aria-selected={value === category.id}
          className={optionClass(value === category.id)}
          style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
          onClick={() => onChange(category.id)}
        >
          <i
            className={`bi ${
              hasChildren || depth === 0 ? 'bi-folder' : 'bi-tag'
            }`}
          />{' '}
          {category.name}
          {(category.note_count ?? 0) > 0 && (
            <span className="badge text-bg-secondary ms-auto">
              {category.note_count}
            </span>
          )}
        </button>
      ))}
      {allowNotANote && (
        <>
          <hr className="my-1" />
          <button
            type="button"
            role="option"
            aria-selected={value === NOT_A_NOTE}
            className={`${optionClass(value === NOT_A_NOTE)} text-danger`}
            title={t('picker.notANoteHint')}
            onClick={() => onChange(NOT_A_NOTE)}
          >
            <i className="bi bi-arrow-return-left" /> {t('picker.notANote')}
          </button>
        </>
      )}
    </div>
  );
}

export default CategoryPicker;
