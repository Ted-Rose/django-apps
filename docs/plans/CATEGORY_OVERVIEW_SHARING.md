# Proposal: Shareable category overviews

Status: implemented (migration `0018_categoryoverviewshare`
generated, not applied — `migrate` runs at deploy).

## 1. Goal

Let a user share their category overview
(`/finance/categories/`) with another user by username — same UX
as account sharing on the Accounts page. A share covers either
the sharer's **whole** overview or a **subset of accounts** the
sharer can see — including accounts only shared *with* them
(re-sharing an account you don't own is explicitly supported).
The category overview page gains a subsection nav bar
("My overview" + one entry per user who shared with me);
selecting an entry shows that user's overview exactly as they
see it — their permitted accounts, their category taxonomy,
their per-transaction exclusions — including the transaction
drill-down.

## 2. Current state

- `AccountShare` (`finance/models.py`) grants read access to a
  whole **account**: shared transactions flow into the sharer's
  transactions page, balance check, limits and category overview
  via `Account.objects.for_user()` /
  `Transaction.objects.for_user()` (`finance/managers.py`).
- `category_overview` (`finance/api.py` ~L802) is keyed entirely
  on `request.user`: transaction scope
  (`Transaction.objects.for_user`), category annotations
  (`annotate_effective_category` / `annotate_counted_amount` in
  `services/categories.py`), `Category.objects.filter(user=…)`,
  and `_account_options(user)`.
- Categorization is per-user (`UserTransactionCategory`) —
  including on shared-in accounts: a sharer assigns their own
  categories to the owner's transactions, and never sees the
  owner's. So a user's overview is *their* taxonomy over
  *everything `for_user` shows them* — exactly the thing this
  feature shares.
- Sharing UX precedent: `POST /api/finance/accounts/{id}/share/`
  + `ShareIn{username}` + `ShareAccountForm` validation +
  `useShareAccount` mutation + the inline `acct-share-form` in
  `Accounts.tsx` (icon button → username input). There is no
  unshare endpoint — `AccountShare` revocation is admin-only
  (tested via `share.delete()`).

## 3. Design decision: dedicated share model, not AccountShare

"Share my overview" must NOT create `AccountShare` rows: that
would push the accounts into the viewer's transactions page,
balance check, accounts list and rule engine — far wider than
intended. Instead add a narrow, purpose-built row:

```python
class CategoryOverviewShare(models.Model):
    """Read access to (part of) the sharer's category overview.

    ``accounts`` empty = the sharer's whole overview (every
    account ``for_user(sharer)`` covers). Non-empty = only those
    accounts — which may be owned or merely shared with the
    sharer.
    """
    sharer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='overview_shares',
    )
    shared_with = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='shared_overviews',
    )
    accounts = models.ManyToManyField(
        Account,
        blank=True,
        related_name='overview_shares',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('sharer', 'shared_with')
```

One share row per (sharer, viewer) pair; the account set is
edited by re-sharing. `python manage.py makemigrations` (never
`migrate` — per repo rules).

## 4. Scope — the sharer's view, optionally account-limited

Unlike plain account sharing, the "owner" of a share needn't own
the accounts: anything `for_user(sharer)` covers is fair game —
that's the sharer's own view, and re-sharing a shared-in
account's categorization is an explicit requirement.

The **effective account set** of a share (computed per request,
never stored) is:

```python
visible = Account.objects.for_user(sharer)
if share.accounts.exists():
    accounts = share.accounts.filter(pk__in=visible)
else:
    accounts = visible
```

Intersecting with `for_user(sharer)` on every read keeps the
share honest if the sharer later loses access to an account
(their `AccountShare` is revoked) — the viewer's access shrinks
automatically, no cleanup needed.

Transactions in a shared view are
`Transaction.objects.filter(account__in=accounts)` — i.e. only
what the share covers — annotated with the **sharer's** taxonomy
(their `UserTransactionCategory` rows work on shared-in accounts
too, so the view is coherent: the viewer sees the sharer's own
categories on someone else's transactions).

Privacy note: a shared view can therefore contain transactions
owned by a third party (when the sharer re-shares a shared-in
account). That is the requested behavior — the sharer already
has full read access to that data; the share row just extends
the audience.

## 5. Backend changes (`finance/api.py`)

### 5.1 Shared authorization helper

```python
def _resolve_overview_user(request, owner_username):
    """(view_user, accounts) for the overview being viewed.

    Empty/own username → (request.user, for_user(request.user)).
    Otherwise requires CategoryOverviewShare(sharer=owner,
    shared_with=request.user) and returns the share's effective
    account set. 404s on unknown usernames and missing shares so
    the endpoint doesn't reveal which usernames exist.
    """
```

Reused by both read endpoints; `accounts` is the scope for the
transaction query and `_account_options`.

### 5.2 `GET /api/finance/categories/overview/` — add `?owner=<username>`

Everything downstream of the scope line is parameterized on
`view_user` (the sharer) instead of `request.user`:

- `annotate_effective_category(qs, view_user)` and
  `annotate_counted_amount(qs, view_user)` — the sharer's
  taxonomy and exclusions.
- `Category.objects.filter(user=view_user)` for the name/color/
  `is_excluded` lookup and the `categories` payload.
- The transaction base queryset is
  `Transaction.objects.filter(account__in=accounts)`; the
  `?account=` filter then applies within it (a PK outside the
  share just yields empty rows — safe).
- The account dropdown gets the effective account set, not
  `_account_options(view_user)` — an account-scoped share
  doesn't expose the rest of the sharer's accounts.

`CategoryOverviewOut` gains (single-endpoint-per-page rule):

```python
# Username whose overview is shown; null = the caller's own view.
view_owner: Optional[str] = None
# Owners who shared their overview with the caller — drives the
# subsection nav chips.
shared_with_me: List[str] = []
# The caller's outgoing shares — drives the revoke list.
my_shares: List[ShareTargetOut] = []

class ShareTargetOut(Schema):
    username: str
    # Account display labels the share is limited to;
    # empty = the sharer's whole overview.
    accounts: List[str] = []
```

### 5.3 `GET /api/finance/transactions/` — add `?owner=<username>`

Required because the drill-down must work in shared view. Same
`_resolve_overview_user` call at the top, then `user` →
`view_user` throughout: the scope line becomes
`Transaction.objects.filter(account__in=accounts)`, both
annotation calls, `category`/`none`/`manual` filters (they key
off `effective_category_id`, already view-scoped), `categories`
and `counterparties` option lists (built from the same scoped
qs). No `TransactionsOut` schema change needed — the SPA already
knows it's in shared mode from the overview response.

### 5.4 Mutation endpoints

- `POST /api/finance/categories/overview/share/` —
  `ShareOverviewIn{username, accounts: List[int] = []}`.
  `ShareAccountForm` validates the username (400
  `provideUsername`, 400 `unknownUsername` on unknown/self);
  each `accounts` pk must be in `for_user(request.user)` (400
  otherwise — a sharer can only share what they can see). Upsert:
  `get_or_create` the (sharer, shared_with) row, then
  `share.accounts.set(...)` so re-sharing updates the set.
  `MessageOut` with `code='overviewShared'` + `params.username`.
- `POST /api/finance/categories/overview/unshare/` `{username}` —
  delete the share row; `MessageOut` either way (idempotent —
  revoking a non-existent share still succeeds).
- Optional: create a `Notification` row for `shared_with`
  ("<sharer> shared their category overview with you", url
  `/finance/categories/?owner=<sharer>`) so the recipient finds
  out without being told out-of-band. Cheap; include it.

## 6. Frontend changes (`frontend/src/finance/`)

### 6.1 API layer

- `api.ts`: `owner?: string | null` on `CategoryOverviewParams`
  and `TransactionParams` (serialized as `?owner=`).
- `mutations.ts`: `useShareOverview` / `useUnshareOverview` —
  copies of `useShareAccount` posting to the new paths;
  `useShareOverview` takes `{username, accounts: number[]}`.
- Regenerate `api-types.ts` via `gen:types` after schema edits.

### 6.2 `routes/CategoryOverview.tsx`

- **Subsection nav**: a `fin-chip` row directly under `PageShell`
  (above the filters card), rendered when
  `data.shared_with_me.length > 0` or a shared view is active:
  "My overview" chip (clears `?owner=`) + one chip per username
  in `shared_with_me`. Selecting writes `owner` into
  `useSearchParams` and clears `category`/`page` (deep-linkable —
  same pattern as every other filter on this page).
- **Share UI**: a `bi-share` icon button near the chips that
  toggles the `acct-share-form`-style inline form: username
  input + an account checklist (the `data.accounts` options —
  already the caller's `for_user` set) under an
  "only these accounts (all unchecked = everything)" label.
  `my_shares` renders as removable chips below — username plus
  account labels when scoped (× = `useUnshareOverview`). Hidden
  entirely in shared view.
- **Shared mode** (`data.view_owner != null`):
  - Show a "shared by {username}" badge (`acct-shared-badge`
    style) in the nav row.
  - Hide `CategoriesCard` — category management is owner-only;
    `data.categories` in shared mode is the sharer's list, shown
    only implicitly through the table rows.
  - The account dropdown lists only the share's effective
    accounts — for an account-scoped share it may be a single
    entry.
  - Drill-down stays functional but read-only (below).

### 6.3 Read-only drill-down

`TransactionDrilldown` gains `owner` and `readOnly` props;
CategoryOverview passes `owner={params.owner}` and
`readOnly={data.view_owner != null}`:

- `params` forwarded to `fetchTransactions` include `owner`.
- `readOnly` flows into `TransactionTable`: the category badge
  renders as a plain `CategoryBadge` (no dropdown — assign/
  exclusion writes would create *the viewer's*
  `UserTransactionCategory` rows on the sharer's transactions,
  which is meaningless), `onAddRule` affordance hidden, rule
  drawer not opened. Sorting/pagination/search stay enabled —
  they're read-only by nature.
- The limits page's `TransactionDrilldown` usage is untouched
  (`readOnly` defaults false, no `owner`).

## 7. i18n

New keys under `categories.*` in `finance/locales/en.json` +
`lv.json`: `myOverview`, `sharedBy` (reuse `accounts.sharedBy`
shape), `shareOverview`, `username`, `onlyTheseAccounts`,
`sharedWith`, `unshare`, plus `server:categories.*` codes for
`overviewShared` etc. following the existing `code`/`params`
catalog pattern.

## 8. Tests

`finance/test_api.py` (HTTP contract):

- Share: happy path creates the row; self-share and unknown
  username → 400; re-sharing updates the account set; a pk not
  in `for_user(sharer)` → 400.
- Unshare: deletes the row; repeat unshare still succeeds.
- Overview `?owner=`: 404 without a share; with a share returns
  the sharer's taxonomy (a category the *viewer* doesn't have
  must appear; the viewer's own categories must not leak in);
  sharer's `is_excluded`/`excluded_amount` respected.
- Account-scoped share: rows/accounts contain only the share's
  accounts; sharing a shared-*in* account works and shows the
  sharer's categories on the owner's transactions; revoking the
  underlying `AccountShare` shrinks the visible set.
- Transactions `?owner=`: same 404 gate; rows show the sharer's
  category/exclusion annotations; pagination unaffected.

`CategoryOverview.test.tsx` (Vitest): chips render only when
`shared_with_me` non-empty or shared view active; shared view
hides `CategoriesCard` and the share UI; `?owner=` is in the
overview query key and forwarded to the drill-down.

## 9. Explicitly out of scope

- An owner-switcher on the transactions page itself — `?owner=`
  is only wired into the category overview's drill-down.
- Per-viewer custom aggregation — the shared view is strictly
  "the sharer's view over the share's accounts".
- Editing an account share's taxonomy — shared views are
  read-only end to end (drill-down included).
