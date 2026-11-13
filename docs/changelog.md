# google_api

## Changelog
34. Category pickers on the transactions page now show each
    category's color: a row's assign menu lists the same tinted
    pills you see on the categories page, and the column-header
    filter puts a color dot beside every name
33. The finance rules list now opens folded: the card is renamed
    "More rules" and stays collapsed until you click its header —
    the New rule and Re-apply rules buttons stay reachable in the
    header either way
32. Apps no longer reload when you switch between them: the
    dashboard, Tasks, Finance, Gmail and Notes now run inside one
    shared page, so moving between sections is instant and lists
    stay cached instead of re-fetching on every visit. App pages
    are also served from the CDN edge and load a little faster;
    your username, language and staff flag are fetched quietly in
    the background. The dashboard itself is part of the app now
    (same cards as before, still public)
31. The Vercel function timeout is pinned at 300 seconds again
    (the maximum under Fluid compute — the old 60s override was
    lost in the caching rework), so slow endpoints like Gmail
    TTS audio generation and tasks sync keep their headroom
30. Mobile fix: the transaction row's category dropdown no longer
    spills past the screen's right edge — its menu anchors to the
    badge's right edge and row menus share the same viewport
    width cap the header filter menus already had
29. Rule drawer cleanup: the description filter now sits at the top
    of the form, the category picker shows each category's color
    dot both on the selected value and inside the dropdown list,
    and the counterparty, description-exclusion and options
    sections fold away by default — expanding automatically when
    they hold a value and previewing it on the folded header
28. Clicking a category on the spending overview now opens its
    transactions directly beneath the breakdown table — above the
    donut chart — where the panel's close button dismisses them
27. Categories is now the finance app's landing page — `/finance/`
    opens the spending overview and the Categories tab and burger
    entry moved first in the navigation
26. Category spending now opens on the current month; the Last
    year and All time shortcuts moved out of the chip row into
    the calendar filter form (All time covers everything from
    2000 onward), the active-range recap line is gone since the
    selected chip and the form's fields already show it, and the
    category management card sits at the bottom of the page
    beneath the Spent/Received totals
25. The category spending page got a cleanup: the share button
    moved into the page header, the bulky Filters card collapsed
    into a calendar icon beside the period chips (the active
    range still shows inline), the breakdown table dropped its
    Received column and totals footer — those figures now live
    in the Spent/Received cards at the bottom of the page — and
    the donut chart reports a rounded percentage plus the spent
    amount on hover; clicking a slice or legend entry pins that
    readout under the chart
24. Faster Vercel loads: the serverless function now runs in
    Frankfurt (same city as the Aiven Postgres, cutting per-request
    DB round-trips since connections are never pooled), hashed JS/
    CSS assets get year-long immutable CDN caching so repeat visits
    skip re-downloads, the app manifest and offline page are cached
    at the edge, and the function bundle shed its dev/server-only
    dependencies for quicker cold starts
23. The home dashboard now shows an Admin card linking to the
    Django admin site — visible only to staff users, matching who
    can actually log in there
22. Reopening the tasks app now returns to the last-viewed section:
    every section page already recorded its URL in the browser, and
    a fresh visit to `/tasks/` now restores it — including the
    dashboard's list/label filters — instead of always landing on
    All Tasks. Direct links still take precedence
21. Recurring tasks no longer flood lists with future occurrences:
    Google materializes every upcoming occurrence of a series as a
    real remote entity, and each used to sync as a separate visible
    (and auto-starred) task — a yearly series showed ~6 identical
    starred rows spanning years ahead. Sync now collapses a series
    to one canonical row bound to the earliest open occurrence and
    hides the future ones; when the current occurrence completes, the
    same task reopens onto the next year keeping its star and
    position, and the completed occurrence stays as its own completed
    task so per-period history accumulates
20. Fixed relinked bank accounts staying disconnected: some banks
    (Swedbank) return the SAME GoCardless account ids on relink,
    so the callback skipped the existing rows and they stayed
    pointed at the dead consent — transactions, balances and
    alerts never refreshed. The callback now repoints such rows
    to the new live requisition in place (transactions, shares,
    limits, alerts and preferences preserved); a new one-off
    `reattach_relinked_accounts` command repairs rows already
    stranded this way
19. Dead bank consents stop retrying: when GoCardless reports an
    expired (401 AccessExpiredError) or suspended (409) consent,
    the requisition is stamped EX/SU locally so every sync,
    balance refresh and alert check skips it instead of
    re-failing daily; sync reports "bank must be relinked" per
    account. Relinking the bank now reconciles by IBAN — the
    original account row is reattached in place, so transactions,
    shares, limits, alerts and preferences survive the new
    account ids instead of duplicating (issue #57)
18. Fixed audio generation failing for emails over ~1900 chars —
    the 1 MB per-file cap assumed gTTS renders 24 kbps but it
    renders 64 kbps, so legitimate requests hit the cap and
    400'd; the cap is now 4 MB, covering the 5000-char input
    limit. '[image: …]' placeholders and '*' emphasis marks are
    also no longer read aloud
17. The legacy public `/text-to-audio` endpoint is disabled (route
    commented out, code kept) — it was unauthenticated, so anyone
    could burn TTS/GCS operations; the SPAs only use the
    session-authenticated `/api/gmail/audio/` +
    `/api/single_pages/tts/` endpoints. The audio SAs also gained
    objectAdmin on the recordings bucket so the 500-file cap can
    delete old files
16. Text-to-speech audio is capped per file too: generated files
    over 1 MB are rejected before upload (a single file can no
    longer exceed that size), complementing the 500-file bucket
    cap — both guard against abuse and runaway storage growth
15. Stored text-to-speech audio is now capped at 500 files: when a
    new upload pushes the recordings bucket past the limit, the
    oldest files are deleted automatically — a safety net on top
    of the existing 7-day auto-deletion to keep storage inside
    the GCP free tier
14. Task notes and note bodies are rich text: the description
    fields in the tasks and notes apps are now a TipTap editor —
    markdown shortcuts convert live while typing (`#`, `-`, `>`,
    `**bold**`), pasted markdown (plain text or inside an HTML
    clipboard) becomes real structure, and invisible Unicode from
    Word/Docs/mobile keyboards is normalized on paste. Content
    stores as doc-JSON in the new local-only `notes_doc` field;
    `notes` keeps the markdown projection that syncs to Google,
    so Google-side edits still reconcile and existing markdown
    bodies render formatted on load
13. Quick-notes categories nest arbitrarily deep: every `-` in a
    `#notes-<path>` marker is now one level (`#notes-projects-
    World_of_Bible-Easter_eggs` → projects → World Of Bible →
    Easter Eggs) and `_` is the only word-joiner inside a
    segment, so multi-word names must spell `django_apps` —
    `#notes-projects-django-apps` now nests `django` → `apps`.
    The notes SPA renders the deeper tree everywhere (nav
    dropdown, pickers, manage page) and shows subtree note
    counts; categories created under the old two-level rule can
    be deleted from `/notes/categories` after notes reclassify
12. Quick notes: tasks carrying a `#notes-<path>` marker now file
    into an auto-created two-level category tree under a new
    `/notes/` app — hidden from the task views, with rename/merge/
    delete of categories rewriting the marker in member notes.
    The `/notes/` React app mirrors the tasks UI: a dark navbar
    with a category-tree dropdown and search, note cards with a
    marker-hidden title and a collapsible completed section, a
    full-page editor with a category picker (incl. a "not a note"
    escape back to a plain task), and a `/notes/categories`
    management page for add/rename/merge/delete
11. The three per-task Cloud Run jobs and the balance-alerts
    scheduler are gone — the single `all-jobs` job now runs on
    one `all-jobs-daily` 03:00 UTC Cloud Scheduler trigger;
    which finance commands execute is controlled solely by the
    `JOBS` list in `run_all_jobs.py`
10. A single `all-jobs` Cloud Run job (`manage.py run_all_jobs`)
    now runs the finance scheduled commands in one pass — Phase 1
    of consolidating the per-task jobs to stay in the free Cloud
    Scheduler quota; the existing jobs and balance-alerts schedule
    are unchanged for now
9. Tasks gains a label management page at `/tasks/labels` — edit
   each label's badge color via a color picker or hex input (labels
   are app-local and never sync to Google)
8. Finance re-applies the visitor's categorization rules over all
   their transactions on every page load, so categorization is
   always enforced when the app is opened
7. Finance balance/spending-limit push alerts now actually reach
   devices that are asleep or offline when the daily 03:00 UTC job
   runs — pushes are sent with a 12h TTL and high urgency instead
   of pywebpush's default TTL=0, which made FCM silently discard
   them
6. Finance category overview gains a "Last year" preset — the
   round 12 months ending with last calendar month — which also
   reveals a spending-per-category-per-month matrix (per-currency
   overall totals in the footer) under the breakdown table
5. Google Tasks sync is much faster for heavy accounts: per-list
   pulls run in parallel, ghost-task cleanup is one UPDATE, and
   post-sync label processing prefetches labels once instead of
   re-querying per hashtag (~190 → ~13 DB queries end-to-end) —
   fixes sync timeouts at Vercel's 60s cap
4. Removed the `tv_archive` and `bible_research` apps (with
   `/tv-arhivs`, `/bible/`, `/bible/verses`, the
   `tv_archive_content` table, and the `googletrans` dependency) —
   resolves security findings F8/F9
3. Endpoint `/gmail-to-audio?` trims boilerplate from eklase
   messages and hides message body by default
2. Endpoint `/twister` generates audio from text giving the user
   functionality to create Twister game bot who gives instructions
   for each player
1. Endpoint `/gmail-to-audio?` helps user to rethrieve his Gmail
   emails and read them in audio format

## ToDoList

1. text-to-audio endpoint should accept text as body not quqery parameter
2. text-to-audio endpoint should check if audio exists and if not create it

### Twister
1. Add functionality to input audio via microphone
