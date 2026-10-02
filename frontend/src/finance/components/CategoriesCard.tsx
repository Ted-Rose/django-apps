import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import CategoryBadge from './CategoryBadge';
import CollapsibleCard from './CollapsibleCard';
import type { CategoryOut } from '../api';
import { useDeleteCategory, useSaveCategory } from '../mutations';

/** Narrow screens start with categories collapsed. jsdom has no
 *  matchMedia, so fall back to open. */
const isNarrowScreen = () =>
  typeof window.matchMedia === 'function' &&
  !window.matchMedia('(min-width: 768px)').matches;

/**
 * The categories card: name + color create/edit form (the API
 * update_or_creates on (user, name), so "edit" just refills the
 * form) and the category list with edit/delete actions. Moved from
 * the rules page to the category overview page.
 */
export function CategoriesCard({ categories }: { categories: CategoryOut[] }) {
  const { t } = useTranslation('finance');
  const saveCategory = useSaveCategory();
  const deleteCategory = useDeleteCategory();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6c757d');
  const [editingId, setEditingId] = useState<number | null>(null);

  const reset = () => {
    setName('');
    setColor('#6c757d');
    setEditingId(null);
  };

  return (
    <CollapsibleCard
      id="categoriesCollapse"
      title={t('categories.manageTitle')}
      count={categories.length}
      defaultOpen={!isNarrowScreen()}
    >
      <form
        className="row g-2 align-items-end mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          saveCategory.mutate(
            { name: trimmed, color },
            { onSuccess: (result) => result?.success && reset() },
          );
        }}
      >
        <div className="col-6">
          <label className="form-label" htmlFor="cat-name">
            {t('categories.nameLabel')}
          </label>
          <input
            type="text"
            id="cat-name"
            maxLength={100}
            className="form-control"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="col-3">
          <label className="form-label" htmlFor="cat-color">
            {t('categories.colorLabel')}
          </label>
          <input
            type="color"
            id="cat-color"
            className="form-control form-control-color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </div>
        <div className="col-3 d-flex gap-1">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saveCategory.isPending}
          >
            {editingId !== null
              ? t('common:common.save')
              : t('common:common.add')}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="btn btn-link btn-sm"
              onClick={reset}
            >
              {t('common:common.cancel')}
            </button>
          )}
        </div>
      </form>
      {categories.length > 0 ? (
        <ul className="cat-list list-unstyled mb-0">
          {categories.map((category) => (
            <li
              key={category.id}
              className="cat-row d-flex justify-content-between align-items-center py-2"
            >
              <CategoryBadge category={category} />
              <span className="d-flex gap-1">
                <button
                  type="button"
                  className="btn btn-sm fin-ghost-btn"
                  title={t('categories.editCategory')}
                  aria-label={t('categories.editCategoryAria', {
                    name: category.name,
                  })}
                  onClick={() => {
                    setName(category.name);
                    setColor(category.color || '#6c757d');
                    setEditingId(category.id);
                  }}
                >
                  <i className="bi bi-pencil" />
                </button>
                <button
                  type="button"
                  className="btn btn-sm fin-ghost-btn fin-ghost-danger"
                  title={t('categories.deleteCategory')}
                  aria-label={t('categories.deleteCategoryAria', {
                    name: category.name,
                  })}
                  disabled={deleteCategory.isPending}
                  onClick={() => deleteCategory.mutate(category.id)}
                >
                  <i className="bi bi-trash" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted small mb-0">
          {t('categories.emptyCategories')}
        </p>
      )}
    </CollapsibleCard>
  );
}

export default CategoriesCard;
