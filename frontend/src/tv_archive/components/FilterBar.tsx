import type { FormEvent } from 'react';

/**
 * Filter form — a React port of content_list.html's GET form, with
 * the plan's Stage 2 upgrades: `channel`, `content_rating` and the
 * new `type` become <select>s fed by the response's option lists
 * (`not_channel`/`not_content_rating` stay free text — exclusion
 * values may not exist as option-list entries). `ratio` is labeled
 * "Min ratio" because the API semantics changed to `ratio__gte`.
 *
 * The form is uncontrolled and remounted by the parent
 * (`key={searchParams}`) whenever the URL changes, so inputs always
 * reflect the active query string. Submitting writes every non-empty
 * field to the search params via `onApply`; empty fields are omitted
 * and `page` resets.
 */

/** Field order mirrors the template's form top-to-bottom. Feed also
 *  uses this list to read the filter params out of the URL. */
export const FILTER_FIELDS = [
  'content_rating',
  'not_content_rating',
  'rating_value',
  'start_date',
  'end_date',
  'ratio',
  'channel',
  'not_channel',
  'type',
] as const;

type FilterField = (typeof FILTER_FIELDS)[number];

export type FilterValues = Partial<Record<FilterField, string>>;

interface FilterBarProps {
  /** Current filter values from the URL (no `page`). */
  values: FilterValues;
  /** Option lists from ContentsOut — empty until the first load. */
  channels: string[];
  contentRatings: string[];
  types: string[];
  /** Replaces the whole filter state; `page` is always reset. */
  onApply: (values: FilterValues) => void;
}

/** The option list plus the active value if the API didn't list it
 *  (e.g. a channel with no current rows, or a typed-in URL param). */
function optionsWithCurrent(options: string[], current: string): string[] {
  return current && !options.includes(current)
    ? [...options, current]
    : options;
}

function FilterSelect({
  id,
  label,
  options,
  value,
}: {
  id: FilterField;
  label: string;
  options: string[];
  value: string;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <select name={id} id={id} defaultValue={value}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </>
  );
}

export function FilterBar({
  values,
  channels,
  contentRatings,
  types,
  onApply,
}: FilterBarProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const next: FilterValues = {};
    for (const field of FILTER_FIELDS) {
      const value = String(formData.get(field) ?? '').trim();
      if (value !== '') next[field] = value;
    }
    onApply(next);
  };

  return (
    <form className="filter-form" onSubmit={handleSubmit}>
      <FilterSelect
        id="content_rating"
        label="Content Rating:"
        options={optionsWithCurrent(
          contentRatings,
          values.content_rating ?? '',
        )}
        value={values.content_rating ?? ''}
      />

      <label htmlFor="not_content_rating">Exclude Exact Rating:</label>
      <input
        type="text"
        name="not_content_rating"
        id="not_content_rating"
        defaultValue={values.not_content_rating ?? ''}
        placeholder="e.g., R"
      />

      <label htmlFor="rating_value">Minimum Rating:</label>
      <input
        type="number"
        step="0.1"
        name="rating_value"
        id="rating_value"
        defaultValue={values.rating_value ?? ''}
      />

      <label htmlFor="start_date">Start Date:</label>
      <input
        type="date"
        name="start_date"
        id="start_date"
        defaultValue={values.start_date ?? ''}
      />

      <label htmlFor="end_date">End Date:</label>
      <input
        type="date"
        name="end_date"
        id="end_date"
        defaultValue={values.end_date ?? ''}
      />

      <label htmlFor="ratio">Min ratio:</label>
      <input
        type="number"
        step="0.1"
        name="ratio"
        id="ratio"
        defaultValue={values.ratio ?? ''}
      />

      <FilterSelect
        id="channel"
        label="Channel:"
        options={optionsWithCurrent(channels, values.channel ?? '')}
        value={values.channel ?? ''}
      />

      <label htmlFor="not_channel">Not Channel:</label>
      <input
        type="text"
        name="not_channel"
        id="not_channel"
        defaultValue={values.not_channel ?? ''}
      />

      <FilterSelect
        id="type"
        label="Type:"
        options={optionsWithCurrent(types, values.type ?? '')}
        value={values.type ?? ''}
      />

      <button type="submit">Filter</button>
      <button type="button" onClick={() => onApply({})}>
        Clear
      </button>
    </form>
  );
}

export default FilterBar;
