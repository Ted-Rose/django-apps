import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AccountOptionOut,
  CategoryOut,
  LimitOut,
  LimitSaveIn,
} from '../api';
import { useSaveLimit } from '../mutations';

/**
 * The create/edit limit form ported from limits.html — driven by
 * the `?edit=<id>` search param (the route resolves it to a
 * LimitOut and passes it as `editing`; the form remounts via `key`
 * so initial state always matches the row being edited).
 *
 * Field order and labels mirror TransactionLimitForm: account,
 * category ("All categories" empty option), the three window
 * amounts — any combination may stay blank to disable that
 * window — and the is_active checkbox. Validation stays
 * server-side (the API runs the same Django form), so errors come
 * back as toasts, including the 409 account+category conflict.
 */
export function LimitForm({
  accounts,
  categories,
  editing,
  onSaved,
  onCancelEdit,
}: {
  accounts: AccountOptionOut[];
  categories: CategoryOut[];
  editing: LimitOut | null;
  /** Called after a successful save — the route clears `?edit=`. */
  onSaved: () => void;
  /** The template's "Cancel" link back to the plain limits URL. */
  onCancelEdit: () => void;
}) {
  const { t } = useTranslation('finance');
  const saveLimit = useSaveLimit();
  const [account, setAccount] = useState(
    editing ? String(editing.account.id) : '',
  );
  const [category, setCategory] = useState(
    editing?.category ? String(editing.category.id) : '',
  );
  const [limit7Days, setLimit7Days] = useState(editing?.limit_7_days ?? '');
  const [limit30Days, setLimit30Days] = useState(editing?.limit_30_days ?? '');
  const [limitMonthly, setLimitMonthly] = useState(
    editing?.limit_monthly ?? '',
  );
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: LimitSaveIn = {
      account: account ? Number(account) : null,
      category: category ? Number(category) : null,
      limit_7_days: limit7Days || null,
      limit_30_days: limit30Days || null,
      limit_monthly: limitMonthly || null,
      is_active: isActive,
    };
    if (editing) payload.limit_id = editing.id;
    saveLimit.mutate(payload, {
      onSuccess: (result) => {
        if (result?.success) onSaved();
      },
    });
  };

  return (
    <>
      {editing && (
        <div className="alert alert-secondary py-2">
          {t('limits.form.editingNotice')}{' '}
          <button
            type="button"
            className="btn btn-link btn-sm p-0 align-baseline"
            onClick={onCancelEdit}
          >
            {t('common:common.cancel')}
          </button>
        </div>
      )}
      <form onSubmit={submit}>
        <div className="mb-3">
          <label className="form-label" htmlFor="limit-account">
            {t('limits.form.account')}
          </label>
          <select
            id="limit-account"
            className="form-select"
            required
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          >
            <option value="" disabled>
              {t('limits.form.selectAccount')}
            </option>
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="limit-category">
            {t('limits.form.category')}
          </label>
          <select
            id="limit-category"
            className="form-select"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">{t('limits.form.allCategories')}</option>
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
        <div className="limit-windows mb-3">
          <p className="fw-semibold mb-1">{t('limits.form.timeWindows')}</p>
          <p className="text-muted small mb-3">
            {t('limits.form.timeWindowsHint')}
          </p>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label" htmlFor="limit-7-days">
                {t('limits.form.per7Days')}
              </label>
              <input
                type="number"
                id="limit-7-days"
                className="form-control"
                step="0.01"
                min="0"
                value={limit7Days}
                onChange={(event) => setLimit7Days(event.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="limit-30-days">
                {t('limits.form.per30Days')}
              </label>
              <input
                type="number"
                id="limit-30-days"
                className="form-control"
                step="0.01"
                min="0"
                value={limit30Days}
                onChange={(event) => setLimit30Days(event.target.value)}
              />
            </div>
            <div className="col-md-4">
              <label className="form-label" htmlFor="limit-monthly">
                {t('limits.form.perMonth')}
              </label>
              <input
                type="number"
                id="limit-monthly"
                className="form-control"
                step="0.01"
                min="0"
                value={limitMonthly}
                onChange={(event) => setLimitMonthly(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="mb-3 form-check form-switch">
          <input
            type="checkbox"
            id="limit-is-active"
            className="form-check-input"
            role="switch"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <label className="form-check-label" htmlFor="limit-is-active">
            {t('limits.form.isActive')}
          </label>
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={saveLimit.isPending}
        >
          {saveLimit.isPending && (
            <>
              <span
                className="spinner-border spinner-border-sm"
                role="status"
              />{' '}
            </>
          )}
          {editing
            ? t('common:common.update')
            : t('common:common.save')}
        </button>
      </form>
    </>
  );
}

export default LimitForm;
