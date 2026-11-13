import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AccountOptionOut,
  CategoryOut,
  LimitOut,
  LimitSaveIn,
  PushConfigOut,
} from '../api';
import { useSaveLimit } from '../mutations';
import usePushSubscription from '../hooks/usePushSubscription';

/**
 * The create/edit limit form ported from limits.html — driven by
 * the `?edit=<id>` search param (the route resolves it to a
 * LimitOut and passes it as `editing`; the form remounts via `key`
 * so initial state always matches the row being edited).
 *
 * Field order and labels mirror TransactionLimitForm: accounts
 * (checkboxes — one limit covers one or more accounts), category
 * ("All categories" empty option), the monthly amount and the
 * alerts switch. The switch doubles as the notification opt-in —
 * off by default on the create form, so turning it on always runs
 * `ensureSubscribed`, which asks the browser for notification
 * permission when needed: a denied or unsupported result leaves
 * the limit disabled. Validation stays server-side
 * (the API runs the same Django form), so errors come back as
 * toasts, including the 409 account+category conflict.
 */
export function LimitForm({
  accounts,
  categories,
  editing,
  pushConfig,
  onSaved,
  onCancelEdit,
}: {
  accounts: AccountOptionOut[];
  categories: CategoryOut[];
  editing: LimitOut | null;
  pushConfig: PushConfigOut;
  /** Called after a successful save — the route clears `?edit=`. */
  onSaved: () => void;
  /** The template's "Cancel" link back to the plain limits URL. */
  onCancelEdit: () => void;
}) {
  const { t } = useTranslation('finance');
  const saveLimit = useSaveLimit();
  const push = usePushSubscription(pushConfig);
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>(
    editing ? editing.accounts.map((a) => a.id) : [],
  );
  const [category, setCategory] = useState(
    editing?.category ? String(editing.category.id) : '',
  );
  const [limitMonthly, setLimitMonthly] = useState(
    editing?.limit_monthly ?? '',
  );
  const [isActive, setIsActive] = useState(editing?.is_active ?? false);

  const toggleAccount = (id: number) =>
    setSelectedAccounts((selected) =>
      selected.includes(id)
        ? selected.filter((a) => a !== id)
        : [...selected, id],
    );

  const toggleAlerts = async (checked: boolean) => {
    if (!checked) {
      setIsActive(false);
      return;
    }
    setIsActive(await push.ensureSubscribed());
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: LimitSaveIn = {
      accounts: selectedAccounts,
      category: category ? Number(category) : null,
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
        <fieldset className="mb-3">
          <legend className="form-label mb-1">
            {t('limits.form.accounts')}
          </legend>
          {accounts.map((option) => (
            <div className="form-check" key={option.id}>
              <input
                type="checkbox"
                id={`limit-account-${option.id}`}
                className="form-check-input"
                checked={selectedAccounts.includes(option.id)}
                onChange={() => toggleAccount(option.id)}
              />
              <label
                className="form-check-label"
                htmlFor={`limit-account-${option.id}`}
              >
                {option.label}
              </label>
            </div>
          ))}
        </fieldset>
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
        <div className="mb-3">
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
        <div className="mb-3 form-check form-switch">
          <input
            type="checkbox"
            id="limit-is-active"
            className="form-check-input"
            role="switch"
            checked={isActive}
            disabled={push.busy}
            onChange={(event) => void toggleAlerts(event.target.checked)}
          />
          <label className="form-check-label" htmlFor="limit-is-active">
            {t('limits.form.alerts')}
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
          {editing ? t('common:common.update') : t('common:common.save')}
        </button>
      </form>
    </>
  );
}

export default LimitForm;
