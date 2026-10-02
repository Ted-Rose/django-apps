# Plan: Manual category assignment for transactions

Let the user assign a category to a single transaction directly from
the transactions table — the assignment is stored as a
`UserTransactionCategory` row with `is_manual=True`, which rules
already never touch. The same affordance also offers "create rule
from this transaction" (today's only action), and manual overrides
are visually marked and filterable so the user can audit and revert
them.

## What already exists

No migration or rules-engine work is needed for the core feature:

- `UserTransactionCategory.is_manual` —
  "Manual override; rules never change this row"
  (`finance/models.py`). One row per `(user, transaction)`, so manual
  overrides are per-user: a sharer's override never affects the
  owner's rows and vice versa.
- `categorize_transaction()` returns early on `is_manual` rows;
  `apply_rules()`, `preview_rule()` and the sync path
  (`sync_account_transactions` → `categorize_transaction`) all defer
  to it (`finance/services/rules.py`, `finance/services/sync.py`).
- Test coverage: `test_manual_category_never_overwritten` in
  `finance/tests.py`. Admin lists/filters `is_manual`.
- `TransactionOut.effective_category` already resolves the caller's
  own assignment via `annotate_effective_category` — a manual row is
  indistinguishable today only because the flag isn't annotated.

**Missing:** an API to write/clear `is_manual`, the flag on
`TransactionOut`, the UI picker, and a way to list manual overrides.

## Design decisions

- **The category cell is the edit affordance.** Modern finance apps
  (Monarch, Copilot, YNAB) make the category badge itself clickable —
  one click on the badge opens a dropdown with the user's categories.
  The existing shared `Dropdown` component fits directly; categories
  already ship inside `TransactionsOut`, so the picker needs no
  extra fetch. The per-row tag button is removed — "create rule from
  this transaction" becomes a menu item at the bottom of the same
  dropdown, keeping one affordance per cell.
- **Clearing = revert to automatic, not delete.** `POST …/clear/`
  unsets `is_manual` and immediately re-runs
  `categorize_transaction()` for that one transaction, so the badge
  deterministically shows what the rules produce (possibly nothing).
  Just flipping the flag would leave the stale manual category
  visible until the next ruleset mutation — confusing.
- **`source=manual` filter param** on `GET /api/finance/transactions/`
  for the audit view, exposed as a "Manual only" item in the
  Category column's header menu plus the usual removable chip.
  Follows the existing `category=none` pseudo-value pattern but is a
  separate param so it composes with the category filter.
- **`UserTransactionCategory.category` becomes nullable** so "locked
  uncategorized" is expressible — without it, deleting the row just
  lets rules reassign on the next run. `is_manual` rows are skipped
  wholesale by `categorize_transaction`, so a NULL-category manual
  row needs no engine changes; `effective_category_for` and the
  `effective_category_id` annotation already return NULL. Menu gets
  a "No category" item that writes `category=None, is_manual=True`.
  Alternative (skip this): omit the item and accept that a manual
  row always names a category. Recommended: include it — one small
  migration, no engine churn.
- **Manual marker on the badge.** `TransactionOut.category_is_manual`
  drives a `bi-pencil-fill` suffix (or dashed-badge CSS variant) on
  `CategoryBadge` in the table cell. Same flag styles the
  "Revert to automatic" menu item's visibility.
- **`get_object_or_404` scoping as usual**: transactions via
  `Transaction.objects.for_user(request.user)` (owner or sharer —
  either may override for themselves), categories via
  `Category.objects.filter(user=request.user)`.

## Changes

### 1. Model + migration — `finance/models.py`

Make `UserTransactionCategory.category` nullable
(`null=True, blank=True`) so a manual row can lock "uncategorized".
`python manage.py makemigrations finance` — additive, shipped by the
deploy workflow's migrate job. Never run `migrate` locally.

If the nullable option is rejected, skip this section entirely —
everything else works unchanged.

### 2. Effective-category helpers — `finance/services/categories.py`

Add the flag annotation next to the id one:

```python
def annotate_effective_category(qs, user):
    return qs.annotate(
        effective_category_id=_user_category_subquery(
            user, 'category_id'
        ),
        category_is_manual=_user_category_subquery(user, 'is_manual'),
    )
```

(Subquery returns NULL when no row — `TransactionOut` reads it as
`Optional[bool]` / falsy.)

### 3. API — `finance/api.py`

Schemas:

```python
class TransactionOut(Schema):
    # …existing fields…
    category_is_manual: Optional[bool] = None

class AssignCategoryIn(Schema):
    # null = lock as uncategorized (requires nullable category FK)
    category: Optional[int] = None
```

Endpoints:

```python
@router.post('/transactions/{tx_id}/category/', response=MessageOut)
def assign_category(request, tx_id: int, payload: AssignCategoryIn):
    tx = get_object_or_404(
        Transaction.objects.for_user(request.user), pk=tx_id
    )
    category = None
    if payload.category is not None:
        category = get_object_or_404(
            Category, pk=payload.category, user=request.user
        )
    UserTransactionCategory.objects.update_or_create(
        user=request.user,
        transaction=tx,
        defaults={'category': category, 'is_manual': True},
    )
    # message: 'Category "X" assigned.' / 'Marked as uncategorized.'


@router.post('/transactions/{tx_id}/category/clear/',
             response=MessageOut)
def clear_category(request, tx_id: int):
    tx = get_object_or_404(
        Transaction.objects.for_user(request.user), pk=tx_id
    )
    assignment = UserTransactionCategory.objects.filter(
        user=request.user, transaction=tx
    ).first()
    if assignment is not None:
        assignment.is_manual = False
        assignment.save(update_fields=['is_manual', 'updated_at'])
    categorize_transaction(tx, active_rules_for(request.user),
                           request.user, assignment)
    # message: 'Reverted to automatic categorization.'
```

(`clear` keeps the row when rules still match it; `categorize_transaction`
deletes it when they don't — both land on the correct effective
category in one request.)

`transaction_list` gains a `source` param:

```python
def transaction_list(request, ..., source: str = ''):
    ...
    if source == 'manual':
        transactions = transactions.filter(category_is_manual=True)
    ...
    'selected_source': source,
    'filters_active': bool(... or source),
```

`TransactionsOut` gets `selected_source: str = ''` so the chip label
can render "Source: manual".

### 4. Frontend API surface — `frontend/src/finance/`

- `api.ts`: `TransactionParams` gains `source?: string | null`;
  `fetchTransactions` passes `source` through. `TransactionOut`
  picks up `category_is_manual` from regenerated `api-types.ts`.
- `mutations.ts`: `useAssignCategory(txId, categoryId|null)` →
  `POST /api/finance/transactions/{id}/category/`, and
  `useClearManualCategory(txId)` → `POST …/category/clear/`. Both
  follow the standard shape: toast `message`, `onSettled`
  invalidates `['finance']`.

### 5. Transactions table — `components/TransactionTable.tsx`

- `TransactionRow`'s category cell becomes a `Dropdown` toggle
  rendering `CategoryBadge` (plus `bi-pencil-fill` when
  `tx.category_is_manual`) or a muted "-" / "Set category" prompt.
  `buttonClassName` keeps it looking like a badge, not a button.
- Menu (reuse the column-header menu patterns):
  - header "Assign category";
  - one `FilterItem`-style row per `data.categories` with a `bi-check`
    on the current category → `assign.mutate({txId, categoryId})`;
  - "No category" item → `assign.mutate({txId, categoryId: null})`
    (only when the nullable FK ships);
  - divider + "Create rule from this transaction" → existing
    `onAddRule(tx)` callback (unchanged — still lazy-fetches
    `GET /api/finance/rules/` for `RuleDrawer`);
  - when `category_is_manual`: divider + "Revert to automatic" →
    `clear.mutate(tx.id)`.
- The actions `<td>`/tag button and `ruleLoadingId` prop move into
  the menu item (spinner on the rule item while `rulesQuery` loads).
- Category column header menu gains a "Manual only" `FilterItem` →
  `onUpdate({ source: 'manual' })`; an "All sources" reset clears it.

### 6. Route — `routes/Transactions.tsx`

- `params`/`updateParams` learn `source`; `activeFilters` gains a
  `Source: manual` chip; `clearFilters` clears it.
- `TransactionTable` gets the two new mutation hooks passed down (or
  the row calls them directly — hooks are fine inside `TransactionRow`).
- `RuleDrawer` wiring is unchanged.

### 7. Type regeneration

```bash
python manage.py export_openapi_schema \
    --output frontend/openapi.json \
    && printf '\n' >> frontend/openapi.json \
    && npm run gen:types --prefix frontend
```

### 8. Tests

- `finance/tests.py`: `assign` writes `is_manual=True`;
  re-assigning the same tx updates the same row (unique
  `(user, transaction)`); `clear` re-runs rules — matching rule
  keeps the row with `is_manual=False`, no match deletes it;
  nullable-category manual row survives `apply_rules` uncategorized.
- `finance/test_api.py`: POST contract for both endpoints; 404 on a
  transaction outside `for_user`; 404 on a foreign category;
  `?source=manual` returns only manual rows; `category_is_manual` is
  present in the payload.
- `frontend/src/finance/routes/Transactions.test.tsx`: the badge
  menu renders categories + rule item; manual row shows the revert
  item and the pencil marker.

## Edge cases

- **Category deleted**: `category` FK is `CASCADE` — manual rows die
  with the category and the next `apply_rules` re-categorizes them.
  Consistent with rules-assigned rows.
- **Shared accounts**: manual overrides are per-user rows; a sharer
  overriding a shared transaction never touches the owner's
  assignment, and the ex-viewer cleanup receiver on `AccountShare`
  delete already removes their rows.
- **Preview honesty**: `preview_rule` already skips `is_manual`
  rows, so rule previews won't claim manual transactions would
  change.
- **`category=none` filter vs `source=manual`**: composing both
  shows manually-locked-uncategorized transactions — a sensible
  result, not a corner case to guard.
