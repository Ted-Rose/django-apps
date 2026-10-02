# Boilerplate — new React-first app

Copy-paste templates referenced by SKILL.md. Replace `<app>`
(Django package name), `<entry>` (the slug) and `<Title>`; keep
Python lines ≤79 chars. When in doubt, mirror
`frontend/src/finance/` — it is the canonical implementation.

## Contents

- `<app>/urls.py`
- `django_apps/urls.py` additions
- `<app>/api.py`
- `frontend/src/<entry>/main.tsx`
- `frontend/src/<entry>/App.tsx`
- `frontend/src/<entry>/api.ts`
- `frontend/src/<entry>/mutations.ts`
- `frontend/src/<entry>/components/<App>NavBar.tsx`
- `frontend/src/<entry>/locales/en.json`
- Build registration (vite.config.ts + gen:types)
- `<app>/tests.py` skeleton

## `<app>/urls.py`

```python
from functools import partial

from django.urls import path
from django_apps.views import react_app

app_name = '<app>'

react_app_<app> = partial(react_app, entry='<entry>', title='<Title>')

urlpatterns = [
    # External callbacks / non-SPA Django views go BEFORE the
    # catch-all.
    path('', react_app_<app>, name='index'),
    # No trailing slash on <path:subpath>: it matches both 'x' and
    # 'x/', so client-side routes don't need an APPEND_SLASH hop.
    path('<path:subpath>', react_app_<app>, name='spa_subpath'),
]
```

## `django_apps/urls.py` additions

```python
from <app>.api import router as <entry>_router   # top of file

api.add_router('/<entry>/', <entry>_router)      # next to existing

urlpatterns = [
    # ...
    path('<entry>/', include('<app>.urls', namespace='<app>')),
]
```

## `<app>/api.py`

```python
"""django-ninja router for <app> (mounted at /api/<entry>/)."""
from typing import List

from django.shortcuts import get_object_or_404
from ninja import Query, Router, Schema

router = Router()


class ItemOut(Schema):
    id: int
    name: str


class MessageOut(Schema):
    """The {success, message} contract — the SPA toasts `message`
    (resolving `code`/`params` through the `server` catalog when
    present)."""
    success: bool
    message: str
    code: str | None = None
    params: dict | None = None


@router.get('/items/', response=List[ItemOut])
def items(request, q: str = Query(None, max_length=100)):
    return Item.objects.filter(owner=request.user)


@router.post('/items/{item_id}/rename/', response=MessageOut)
def rename(request, item_id: int, payload: RenameIn):
    item = get_object_or_404(
        Item, id=item_id, owner=request.user)   # per-user scoping
    # reuse a Django Form for validation when one exists:
    # form = RenameForm(payload.dict()); if not form.is_valid():
    #     raise HttpError(400, form.errors.as_json())
    return {'success': True, 'message': f'Renamed to {item.name}.'}
```

## `frontend/src/<entry>/main.tsx`

```tsx
import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { initI18n } from '../shared/i18n';
import queryClient from '../shared/queryClient';
import en from './locales/en.json';
import lv from './locales/lv.json';

// Must run before any component reads t() — catalogs are static
// imports so both languages are already bundled.
initI18n('<entry>', { en, lv });

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/<entry>">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
```

## `frontend/src/<entry>/App.tsx`

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import Items from './routes/Items';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/items" replace />} />
      <Route path="/items" element={<Items />} />
      <Route path="*" element={<Navigate to="/items" replace />} />
    </Routes>
  );
}
```

## `frontend/src/<entry>/api.ts`

```ts
import { apiGet } from '../shared/api/client';
import type { components } from './api-types';

/** Type aliases over the generated OpenAPI schemas (api-types.ts). */
export type ItemOut = components['schemas']['ItemOut'];
export type MessageOut = components['schemas']['MessageOut'];

/** GET /api/<entry>/items/?q= → ItemOut[]. */
export function fetchItems(q = ''): Promise<ItemOut[]> {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  const suffix = qs.toString();
  return apiGet<ItemOut[]>(
    `/api/<entry>/items/${suffix ? `?${suffix}` : ''}`,
  );
}
```

## `frontend/src/<entry>/mutations.ts`

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiPost } from '../shared/api/client';
import { errorDetail } from '../shared/api/errors';
import { serverText } from '../shared/i18n';
import { pushToast } from '../shared/toasts';
import type { MessageOut } from './api';

const KEY = ['<entry>'] as const;

export function useRenameItem() {
  const { t } = useTranslation('<entry>');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { itemId: number; name: string }) =>
      apiPost<MessageOut>(`/api/<entry>/items/${v.itemId}/rename/`, {
        name: v.name,
      }),
    onSuccess: (data) => {
      const message = serverText(data, data?.message);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.renameFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
```

## `frontend/src/<entry>/components/<App>NavBar.tsx`

In-SPA links use `to:`; full-page routes stay `url:` anchors.
Copy `src/finance/components/FinanceNavBar.tsx` and trim to the
app's pages:

```tsx
import { useTranslation } from 'react-i18next';
import NavBar from '../../shared/components/NavBar';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';

export function <App>NavBar() {
  const { t } = useTranslation('<entry>');
  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const items: BurgerMenuItem[] = [
    { label: t('common:common.home'), url: '/', icon: 'house',
      btn_class: 'btn-light' },
    { label: t('nav.items'), to: '/items', icon: 'list',
      btn_class: 'btn-light' },
    { label: t('common:common.logout', { user }),
      url: '/admin/logout/', icon: 'box-arrow-right',
      btn_class: 'btn-outline-light' },
  ];

  return <NavBar title={t('nav.title')} items={items} />;
}
```

## `frontend/src/<entry>/locales/en.json`

Flat-ish keys per page; shared strings (home, logout, loading…)
already exist in the `common`/`server` namespaces under
`src/shared/locales/` — reuse, don't duplicate. `lv.json` mirrors
the same keys.

```json
{
  "nav": { "title": "<Title>", "items": "Items" },
  "mutations": { "renameFailed": "Rename failed: {{detail}}" }
}
```

## Build registration

```ts
// frontend/vite.config.ts → rollupOptions.input
input: {
  tasks: 'src/tasks/main.tsx',
  finance: 'src/finance/main.tsx',
  gmail: 'src/gmail/main.tsx',
  single_pages: 'src/single_pages/main.tsx',
  <entry>: 'src/<entry>/main.tsx',
},
```

```json
// frontend/package.json — add <entry> to the loop's list
"gen:types": "for entry in tasks finance gmail single_pages <entry>; do openapi-typescript ../frontend/openapi.json -o src/$entry/api-types.ts || exit 1; done",
```

Then regenerate (both artifacts are committed):

```bash
source venv/bin/activate
python manage.py export_openapi_schema --output frontend/openapi.json
printf '\n' >> frontend/openapi.json
npm run gen:types --prefix frontend
```

## `<app>/tests.py` skeleton

```python
from django.contrib.auth.models import User
from django.test import TestCase


def make_user(username='a'):
    return User.objects.create_user(username=username, password='pw')


class ApiTests(TestCase):
    def setUp(self):
        self.user = make_user()
        self.client.force_login(self.user)

    def test_unauthenticated_get_401(self):
        self.client.logout()
        resp = self.client.get('/api/<entry>/items/')
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()['error'], 'unauthenticated')
        self.assertIn('login_url', resp.json())

    def test_post_without_csrf_403(self):
        resp = self.client.post(
            '/api/<entry>/items/1/rename/',
            data='{"name": "x"}', content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_per_user_isolation(self):
        # user B cannot see/mutate user A's rows
        ...
```
