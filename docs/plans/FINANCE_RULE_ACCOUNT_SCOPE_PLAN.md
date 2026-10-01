# Plan: Account-scoped categorization rules

Let `CategoryRule` optionally apply to a single **owned** bank account
instead of all of the user's accounts. `account = NULL` keeps today's
behavior (rule applies to every owned account), so existing rules are
fully backward compatible — no data backfill.

## Design decisions

- **Scope = optional `account` FK on `CategoryRule`.** NULL → global.
  Follows the same pattern just added to `TransactionLimit.category`.
- **`on_delete=CASCADE`.** Deleting an account deletes rules scoped to
  it. `SET_NULL` would silently widen a scoped rule to all accounts —
  surprising and dangerous.
- **Scopeable accounts = owned accounts only**
  (`Account.objects.filter(owner=user)`), not `for_user`. Rules only
  ever categorize transactions on accounts the user owns
  (`owned_transactions()`); a rule scoped to a shared account would be
  dead weight — the owner's ruleset categorizes those transactions.
- **Scope is orthogonal to priority.** One global `(priority, pk)`
  ordering; an out-of-scope rule is simply skipped for a transaction.
  Rejected alternative: "account rules always beat global rules" —
  implicit precedence is harder to reason about than a single visible
  ordering the user controls with the up/down buttons.
- **Scope check lives in `first_matching_rule`, not `rule_matches`.**
  Keeps `rule_matches` a pure pattern matcher (existing unit tests
  untouched); the caller filters by scope per transaction.

## Changes

### 1. Model — `finance/models.py`

```python
account = models.ForeignKey(
    Account,
    on_delete=models.CASCADE,
    related_name='category_rules',
    null=True,
    blank=True,
    help_text='Optional: apply only to this account'
)
```

on `CategoryRule`. Optionally extend `__str__` to show the scope.

### 2. Migration

`python manage.py makemigrations finance` → `0006_categoryrule_account`.
Additive, nullable — safe to ship; deploy workflow's migrate job
applies it. Never run `migrate` locally.

### 3. Rules engine — `finance/services/rules.py`

- `first_matching_rule(rules, transaction)`: skip rules where
  `rule.account_id is not None and rule.account_id != transaction.account_id`.
- `categorize_transaction`, `apply_rules`, `active_rules_for`,
  `owned_transactions`: **no signature changes needed** — scope is
  resolved per-transaction inside `first_matching_rule`.
- `preview_rule(user, data)`:
  - Parse `account_id` from `data`; validate it against
    `Account.objects.filter(owner=user)` (return `{'error': ...}` on a
    foreign pk). Missing/empty → `None` (global).
  - Build the candidate `SimpleNamespace` with `account`/`account_id`.
  - `match_count`: count only txs where the candidate is in scope AND
    patterns match (scope check before `rule_matches`).
  - `apply_count`/`changes`: unchanged — `first_matching_rule` now
    skips out-of-scope rules automatically. When the candidate is
    account-scoped, `owned_transactions` can additionally be filtered
    to that account to keep the preview fast.
- Module docstring: document the scope semantics.

### 4. Form — `finance/forms.py`

`CategoryRuleForm`: add `'account'` to `Meta.fields`; in `__init__` set
`self.fields['account'].queryset = Account.objects.filter(owner=user)`
and `empty_label = 'All accounts'`. Queryset scoping doubles as the
ownership validation.

### 5. View — `finance/views.py`

- `rules_view`: pass `accounts` (owned accounts) to the template for
  the drawer dropdown, and add `'account_id': rule.account_id` to each
  dict in `rules_data` (the sandbox's `config.rules`).
- `save_rule`, `preview_rule_view`: no changes — the form/`preview_rule`
  handle the new field.

### 6. Template — `finance/templates/finance/rules.html`

- Rules table: new "Account" column — account name/iban or
  `<span class="text-muted">All</span>`.
- Drawer form: account `<select>` ("All accounts" first option) next
  to Category/Priority.
- Optional: add the account to the preview-changes table (the preview
  payload already includes `change.account`).

### 7. JS — `finance/static/finance/js/rule_sandbox.js`

- `payload()`: `params.set('account_id', field('rule-account').value)`.
- Edit handler: `field('rule-account').value = rule.account_id || ''`.
- New-rule reset already covers it via `form.reset()` (verify the
  select defaults to "All accounts").

### 8. Admin — `finance/admin.py`

Add `'account'` to `CategoryRuleAdmin.list_display`.

### 9. Docs — `finance/AGENTS.md`

Update the `CategoryRule` bullet (optional `account` scope, owned
accounts only, scope orthogonal to priority).

## What doesn't change

- `sync_bank_transactions` — it already passes the owner's active rules
  to `categorize_transaction`; the scope check inside
  `first_matching_rule` handles it. Verify with a test.
- `evaluate_spending_limits` / Cloud Run jobs — unrelated.
- Terraform — no changes.

## Tests (`finance/tests.py`)

- Scoped rule categorizes only its account's transactions; a matching
  tx on another owned account keeps its category.
- Global rule still matches all owned accounts.
- Priority interplay: global rule at priority 1 beats a scoped rule at
  priority 2 on the scoped account (locks in the "scope is a filter,
  not precedence" semantics).
- `apply_rules` with mixed scoped/global rules.
- `preview_rule` with `account_id`: `match_count` excludes other
  accounts' txs; invalid/foreign `account_id` → error.
- Form: `account` queryset excludes shared/other users' accounts.
- Sync path: `sync_account_transactions` applies a scoped rule only to
  the right account.
