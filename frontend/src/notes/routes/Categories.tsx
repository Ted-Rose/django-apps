import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BurgerMenu,
  type BurgerMenuItem,
} from '../../shared/components/BurgerMenu';
import Modal from '../../shared/components/Modal';
import Toasts from '../../shared/components/Toasts';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { fetchNotes, type NoteCategoryOut } from '../api';
import {
  categoryPathLabel,
  descendantIds,
  flattenCategoryTree,
} from '../categories';
import ConfirmModal from '../components/ConfirmModal';
import {
  useCreateCategory,
  useDeleteCategory,
  useMergeCategories,
  useRenameCategory,
} from '../mutations';
import { ErrorState, LoadingSkeleton } from './NotesPage';

/** Merge picker value — a category id or the uncategorized bucket. */
type MergeTarget = number | 'uncategorized' | '';

/**
 * Category management (`/categories`) — the tree at arbitrary
 * depth with subtree note counts plus add/rename/merge/delete.
 * Rename/merge/delete retag member notes' `#notes…` markers
 * server-side; the success toasts report the retagged counts.
 * Destructive ops go through a confirm modal, delete additionally
 * asks where members move to.
 */
export default function Categories() {
  const { t } = useTranslation('notes');
  const navigate = useNavigate();
  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['notes', 'categories'],
    queryFn: () => fetchNotes({}),
  });
  const categories = data?.categories ?? [];
  const rows = flattenCategoryTree(categories);

  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<number | ''>('');
  const [renaming, setRenaming] = useState<NoteCategoryOut | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [merging, setMerging] = useState<NoteCategoryOut | null>(null);
  const [mergeTarget, setMergeTarget] = useState<MergeTarget>('');
  const [deleting, setDeleting] = useState<NoteCategoryOut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | 'uncategorized'>(
    'uncategorized',
  );

  const createCategory = useCreateCategory();
  const renameCategory = useRenameCategory();
  const mergeCategories = useMergeCategories();
  const deleteCategory = useDeleteCategory();

  // Shared by the row button and the merge modal's confirm label.
  const mergeLabel = t('categoriesPage.merge');

  /** Targets a category may fold/move members into — never itself
   *  and never inside its own subtree at any depth (the API
   *  400s on that). Options show the full path so same-named
   *  leaves under different branches stay distinguishable. */
  const validTargets = (source: NoteCategoryOut) => {
    const excluded = descendantIds(categories, source.id);
    excluded.add(source.id);
    return categories.filter((c) => !excluded.has(c.id));
  };

  const openRename = (category: NoteCategoryOut) => {
    setRenameDraft(category.name);
    setRenaming(category);
  };

  const openMerge = (category: NoteCategoryOut) => {
    setMergeTarget('');
    setMerging(category);
  };

  const openDelete = (category: NoteCategoryOut) => {
    setDeleteTarget('uncategorized');
    setDeleting(category);
  };

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    createCategory.mutate(
      { name, parent_id: newParent === '' ? null : newParent },
      {
        onSuccess: () => {
          setNewName('');
          setNewParent('');
        },
      },
    );
  };

  const burgerItems: BurgerMenuItem[] = [
    {
      label: t('common:common.home'),
      url: '/',
      icon: 'house',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.title'),
      icon: 'journal-text',
      btn_class: 'btn-primary',
      onClick: () => navigate('/'),
    },
    {
      label: t('common:common.logout', { user }),
      url: '/admin/logout/',
      icon: 'box-arrow-right',
      btn_class: 'btn-outline-light',
    },
  ];

  const renderRow = (
    category: NoteCategoryOut,
    depth: number,
    hasChildren: boolean,
  ) => (
    <tr key={category.id}>
      <td style={{ paddingLeft: `${0.5 + depth * 1.5}rem` }}>
        <i
          className={`bi ${
            hasChildren || depth === 0 ? 'bi-folder' : 'bi-tag'
          }`}
        />{' '}
        {category.name}
      </td>
      <td className="text-end">{category.note_count ?? 0}</td>
      <td className="text-end">
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => openRename(category)}
          >
            <i className="bi bi-pencil" /> {t('categoriesPage.rename')}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => openMerge(category)}
          >
            <i className="bi bi-arrow-left-right" /> {mergeLabel}
          </button>
          <button
            type="button"
            className="btn btn-outline-danger"
            onClick={() => openDelete(category)}
          >
            <i className="bi bi-trash" /> {t('categoriesPage.delete')}
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <>
      <nav
        className="navbar navbar-expand-lg navbar-dark bg-dark"
        style={{ padding: '0.1rem 0', minHeight: 'auto' }}
      >
        <div className="container-fluid" style={{ padding: '0 0.5rem' }}>
          <div className="d-flex align-items-center gap-1 flex-wrap">
            <Link
              to="/"
              className="btn btn-outline-light btn-sm"
              style={{ padding: '0.15rem 0.4rem' }}
              id="back-to-notes-btn"
            >
              <i className="bi bi-arrow-left" /> {t('categoriesPage.back')}
            </Link>
            <Link
              className="navbar-brand mb-0"
              to="/categories"
              style={{ fontSize: '1rem', padding: '0.25rem 0.5rem' }}
            >
              <i className="bi bi-tags" /> {t('categoriesPage.title')}
            </Link>
          </div>
          <div className="ms-auto d-flex flex-row align-items-center gap-2">
            <BurgerMenu items={burgerItems} />
          </div>
        </div>
      </nav>

      <div className="container-fluid px-2 py-4">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data && (
          <>
            <form
              className="card mb-3"
              onSubmit={(event) => {
                event.preventDefault();
                submitCreate();
              }}
            >
              <div
                className="card-body py-2 d-flex flex-wrap gap-2
                  align-items-center"
              >
                <input
                  type="text"
                  className="form-control form-control-sm w-auto"
                  placeholder={t('categoriesPage.addPlaceholder')}
                  aria-label={t('categoriesPage.add')}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
                <select
                  className="form-select form-select-sm w-auto"
                  aria-label={t('categoriesPage.parent')}
                  value={newParent}
                  onChange={(event) =>
                    setNewParent(
                      event.target.value === ''
                        ? ''
                        : Number(event.target.value),
                    )
                  }
                >
                  <option value="">{t('categoriesPage.topLevel')}</option>
                  {rows.map(({ category, depth }) => (
                    <option key={category.id} value={category.id}>
                      {'  '.repeat(depth)}
                      {category.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!newName.trim() || createCategory.isPending}
                >
                  <i className="bi bi-plus" /> {t('categoriesPage.add')}
                </button>
              </div>
            </form>

            {categories.length === 0 ? (
              <div className="alert alert-info">
                <i className="bi bi-info-circle" /> {t('categoriesPage.empty')}
              </div>
            ) : (
              <div className="card">
                <div className="card-body py-2 px-3">
                  <table className="table table-sm align-middle mb-0">
                    <thead>
                      <tr>
                        <th>{t('categoriesPage.name')}</th>
                        <th className="text-end">
                          {t('categoriesPage.notes')}
                        </th>
                        <th className="text-end">
                          {t('categoriesPage.actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ category, depth, hasChildren }) =>
                        renderRow(category, depth, hasChildren),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rename — prompt explains the marker retag. */}
      <Modal
        show={renaming !== null}
        title={t('categoriesPage.renameTitle')}
        onClose={() => setRenaming(null)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRenaming(null)}
              disabled={renameCategory.isPending}
            >
              {t('common:common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!renameDraft.trim() || renameCategory.isPending}
              onClick={() =>
                renaming &&
                renameCategory.mutate(
                  { categoryId: renaming.id, name: renameDraft.trim() },
                  { onSuccess: () => setRenaming(null) },
                )
              }
            >
              {renameCategory.isPending ? (
                <span className="spinner-border spinner-border-sm me-1" />
              ) : (
                <i className="bi bi-pencil" />
              )}{' '}
              {t('categoriesPage.rename')}
            </button>
          </>
        }
      >
        <p className="text-muted">{t('categoriesPage.renamePrompt')}</p>
        <label htmlFor="rename-category" className="form-label fw-bold">
          {t('categoriesPage.newName')}
        </label>
        <input
          type="text"
          className="form-control"
          id="rename-category"
          value={renameDraft}
          onChange={(event) => setRenameDraft(event.target.value)}
        />
      </Modal>

      {/* Merge — confirm with a target picker. */}
      <ConfirmModal
        show={merging !== null}
        title={t('categoriesPage.mergeTitle')}
        confirmLabel={mergeLabel}
        confirmIcon="arrow-left-right"
        confirmClassName="btn-primary"
        busy={mergeCategories.isPending}
        onClose={() => setMerging(null)}
        onConfirm={() => {
          if (merging && mergeTarget !== '') {
            // 'uncategorized' → null: the API folds members into
            // the bare-#notes bucket.
            const targetId =
              mergeTarget === 'uncategorized' ? null : mergeTarget;
            mergeCategories.mutate(
              { source_id: merging.id, target_id: targetId },
              { onSuccess: () => setMerging(null) },
            );
          }
        }}
      >
        {merging && (
          <>
            <p className="text-muted">{t('categoriesPage.mergePrompt')}</p>
            <p className="fw-bold">{merging.name}</p>
            <label htmlFor="merge-target" className="form-label fw-bold">
              {t('categoriesPage.mergeInto')}
            </label>
            <select
              className="form-select"
              id="merge-target"
              value={mergeTarget}
              onChange={(event) =>
                setMergeTarget(
                  event.target.value === 'uncategorized'
                    ? 'uncategorized'
                    : event.target.value === ''
                      ? ''
                      : Number(event.target.value),
                )
              }
            >
              <option value="" disabled>
                {t('categoriesPage.mergeInto')}
              </option>
              <option value="uncategorized">
                {t('categoriesPage.uncategorized')}
              </option>
              {validTargets(merging).map((target) => (
                <option key={target.id} value={target.id}>
                  {categoryPathLabel(categories, target.id)}
                </option>
              ))}
            </select>
          </>
        )}
      </ConfirmModal>

      {/* Delete — confirm plus where members retag to. */}
      <ConfirmModal
        show={deleting !== null}
        title={t('categoriesPage.deleteTitle')}
        confirmLabel={t('categoriesPage.delete')}
        confirmIcon="trash"
        confirmClassName="btn-danger"
        busy={deleteCategory.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            deleteCategory.mutate(
              { categoryId: deleting.id, to: deleteTarget },
              { onSuccess: () => setDeleting(null) },
            );
          }
        }}
      >
        {deleting && (
          <>
            <p className="text-muted">{t('categoriesPage.deletePrompt')}</p>
            <p className="fw-bold">{deleting.name}</p>
            <label htmlFor="delete-target" className="form-label fw-bold">
              {t('categoriesPage.deleteTarget')}
            </label>
            <select
              className="form-select"
              id="delete-target"
              value={deleteTarget}
              onChange={(event) =>
                setDeleteTarget(
                  event.target.value === 'uncategorized'
                    ? 'uncategorized'
                    : Number(event.target.value),
                )
              }
            >
              <option value="uncategorized">
                {t('categoriesPage.uncategorized')}
              </option>
              {validTargets(deleting).map((target) => (
                <option key={target.id} value={target.id}>
                  {categoryPathLabel(categories, target.id)}
                </option>
              ))}
            </select>
          </>
        )}
      </ConfirmModal>

      <Toasts />
    </>
  );
}
