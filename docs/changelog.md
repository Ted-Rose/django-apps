# google_api

## Changelog
12. Quick notes: tasks carrying a `#notes-<path>` marker now file
    into an auto-created two-level category tree under a new
    `/notes/` app — hidden from the task views, with rename/merge/
    delete of categories rewriting the marker in member notes
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
