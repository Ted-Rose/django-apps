Status: implemented

# Gmail audio size-cap recalibration — plan

Fix audio generation 400ing on ordinary emails over ~1900 chars,
and stop gTTS reading Gmail image placeholders and `*` emphasis
marks aloud. One PR.

Branch: `fix/gmail-audio-cap` — commit this plan file on the
branch (status `in progress` now, `implemented` on completion).
Commit format: `Fix: Capitalized message`.

## Problem and root cause

An unread email ("Spring prayer update from the Bourbeaus",
multipart/mixed, 4 attached JPEGs, 2333 chars of TTS text) fails
to generate audio in the gmail reader SPA:

- `google_api/utils.py:89` sets `AUDIO_FILE_MAX_BYTES =
  1024 * 1024`. The comment at utils.py:85-88 assumes "gTTS is
  ~24 kbps mono, so 1 MB ≈ 5.7 min" and claims the 5000-char
  input cap (utils.py:161-162) "sits right at that boundary".
- gTTS 2.5.1 actually renders ~64 kbps (24 kHz mono, verified
  with afinfo). At 8000 B/s, 1 MiB ≈ 131 s ≈ only ~1900 chars
  of English (~550-610 B/char measured: 1800 chars → 956 KB ok,
  2000 → 1.06 MB rejected, 2333 → 1,413,696 B).
- The oversized render raises `ValueError` at utils.py:233-237,
  which `gmail/api.py:138-139` maps to `ApiHttpError(400)`, and
  the SPA shows the `audioFailed` toast
  (`useAudioQueue.ts:122-129`). Short emails still worked —
  that is why it looked message-specific.
- The frontend truncates at `MAX_AUDIO_TEXT_LENGTH = 2300`
  (`frontend/src/gmail/components/useAudioQueue.ts:26`), so
  effectively EVERY email over ~1900 chars 400s while inputs up
  to 5000 chars remain legal.

The cap was added in a3f02c7 as an anti-abuse guard for the
public `/text-to-audio` endpoint, which is now commented out in
`google_api/urls.py`. Remaining `text_to_audio(` callers are all
session-authenticated: `gmail/api.py:136` (`GET /api/gmail/audio/`),
`single_pages/api.py:48` (`GET /api/single_pages/tts/`), and the
dead `google_api/views.py:38`. The byte check's remaining job is
a backstop against pathological renders, not abuse.

## Decision

Recalibrate the byte cap to the true bitrate AND fold in the
text-sanitizer fix. No frontend changes.

1. Raise `AUDIO_FILE_MAX_BYTES` to `4 * 1024 * 1024` (4 MiB):
   - Backend input cap is 5000 chars; at the measured ~600 B/char
     worst case that renders ~3.0 MB. 4 MiB covers it with ~37%
     headroom for denser/slower speech (Latvian, numbers read
     digit-by-digit) and restores the original intent: the byte
     ceiling never rejects input the char cap allows.
   - 4 MiB ≈ 524 s ≈ 8.7 min of speech at 64 kbps — far above any
     real email.
   - Cost bound: 500 objects (`AUDIO_FILE_LIMIT`) × 4 MiB ≈ 2 GiB
     worst case, further bounded by the 7-day lifecycle rule.
     Acceptable for a single-user personal app (≈ cents/month even
     outside free-tier regions).
2. Keep `MAX_AUDIO_TEXT_LENGTH = 2300` unchanged. It exists to
   keep the GET URL under length limits after encodeURIComponent
   (comment at useAudioQueue.ts:20-26), not to fit the byte cap —
   a 2333-char render (~1.4 MB) now has ~3x margin.
3. Extend `_sanitize_text_for_audio` to strip Gmail's
   `[image: name.jpg]` / `[inline_image]` text/plain placeholders
   and `*` emphasis markers — same feature, small blast radius,
   regression-testable. Directly improves "emails with images".

### Alternatives rejected

- Lower `MAX_AUDIO_TEXT_LENGTH` to ~1500 under the 1 MB cap:
  keeps the storage bound but truncates real email content — the
  2333-char email that triggered this still loses its tail — and
  single_pages `/api/single_pages/tts/` callers up to 5000 chars
  keep 400ing. Rejected.
- ~1.5-2 MB cap (covers only the frontend's 2333-char max):
  leaves the backend's own 5000-char input contract broken for
  other session-authed callers. The byte cap should be consistent
  with the input cap it backstops. Rejected.
- 3 MiB (exact fit for 5000 chars): no headroom for denser
  speech. 4 MiB chosen instead.
- Pre-render char-count size estimate: the post-render
  `os.path.getsize` check (utils.py:231-237) is the only accurate
  measurement; a char estimate duplicates the bitrate math,
  drifts, and can false-positive on dense text. The rejection
  path is now rare enough that paying render latency is fine.
  Out of scope.
- `get_user_credentials` `TransportError`→500 and unguarded
  `oauth_creds.save()` (utils.py:~393-416): auth refresh path,
  unrelated blast radius. Out of scope — worth a separate
  follow-up.

## Exact changes

### `google_api/utils.py`

1. Replace the comment + constant at lines 85-89:

   ```python
   # Per-file ceiling checked after gTTS renders. gTTS actually
   # renders ~64 kbps mono (24 kHz) — ~8000 B/s — so 1 MB ≈ 131 s
   # ≈ only ~1900 chars of English (~600 B/char measured). The old
   # 1 MB cap rejected every render over ~1900 chars while 5000
   # chars stayed legal input. 4 MiB ≈ 8.7 min covers a 5000-char
   # render (~3 MB) with headroom; the check remains the guard
   # against pathological renders.
   AUDIO_FILE_MAX_BYTES = 4 * 1024 * 1024
   ```

   (Keep every comment line ≤ 79 chars.)

2. In `_sanitize_text_for_audio` (lines 113-133), after the URL
   sub at line 124 and replacing the run-strip at line 128:

   ```python
   # Drop Gmail's image placeholders — text/plain parts keep
   # '[image: name.jpg]' / '[inline_image]' for inline images and
   # gTTS read the bracketed label aloud.
   text = re.sub(r'\[(?:image|inline_image)[^\]]*\]', ' ', text)

   # '*' reads as "asterisk" in *emphasis* and bullet lists —
   # strip it unconditionally. '-', '_', '~' and '=' only in 2+
   # runs (divider lines like the e-klase '____' footer) so
   # hyphenated words and 'a ~5 min' approximations survive.
   text = re.sub(r'\*', '', text)
   text = re.sub(r'[-_~=]{2,}', '', text)
   ```

   The `\*` sub is a superset of the old `*`-in-run-class behavior
   (`**bold**` still strips). The whitespace-collapse line
   (131) already cleans up the extra spaces this introduces.

No other code changes. `gmail/api.py`, `single_pages/api.py`,
`google_api/views.py`, and all frontend files stay untouched.

### `google_api/tests.py` — keep + add

Keep passing unchanged (they read the constant, not a literal):

- `test_oversized_render_rejected_before_upload` (359-369) —
  mocks `os.path.getsize` to `AUDIO_FILE_MAX_BYTES + 1`, asserts
  `ValueError` and no upload. Optionally update its stale
  comment ("guard against abuse via the public /text-to-audio
  endpoint") to note the endpoint is now commented out and the
  check guards pathological renders.
- All other `TextToAudio*` tests, incl. the sanitize-adjacent
  `test_divider_runs_stripped_before_tts` (177-186) and
  `test_url_only_text_does_not_crash_detection` (169-175) —
  verify they still pass with the new regexes.

New tests — add to `TextToAudioLimitTests`:

- `test_byte_cap_covers_max_input_at_real_bitrate` — pin the
  invariant so the cap can't silently drift below legal input
  again:
  ```python
  def test_byte_cap_covers_max_input_at_real_bitrate(self):
      # gTTS renders ~64 kbps ≈ ~600 B/char of English measured —
      # the 1 MB cap silently rejected every render over ~1900
      # chars while the 5000-char input cap stayed legal.
      self.assertGreaterEqual(AUDIO_FILE_MAX_BYTES, 5000 * 600)
  ```
- `test_full_length_gmail_render_uploads` — reproduce the real
  failure: the 2333-char request rendered 1,413,696 B and must
  now upload instead of 400ing:
  ```python
  def test_full_length_gmail_render_uploads(self):
      # The production failure: a 2333-char email rendered
      # 1,413,696 B — over the old 1 MB cap, under the new one.
      with self._pipeline() as bucket, \
              patch('google_api.utils.os.path.getsize',
                    return_value=1_413_696):
          url = text_to_audio('x' * 2333, lang='en')
      self.assertEqual(url, 'https://signed/x.mp3')
      bucket.blob.return_value \
          .upload_from_filename.assert_called_once()
  ```

New tests — add to `TextToAudioLanguageTests` (next to
`test_divider_runs_stripped_before_tts`), asserting on
`gtts.call_args.kwargs['text']` via `audio_pipeline()`:

- `test_image_placeholders_not_read_aloud`:
  `text_to_audio('See [image: photo.jpg] and [inline_image] '
  'here', lang='en')` → gTTS gets `'See and here'`.
- `test_emphasis_asterisks_stripped`:
  `text_to_audio('a *bold* and * item', lang='en')` → gTTS gets
  `'a bold and item'`.

### Docs

- `docs/changelog.md` — new entry `18.` at the TOP of the
  google_api changelog (numbered descending, newest first):
  "Fixed audio generation failing for emails over ~1900 chars —
  the 1 MB per-file cap assumed gTTS renders 24 kbps but it
  renders 64 kbps, so legitimate requests hit the cap and 400'd;
  the cap is now 4 MB, covering the 5000-char input limit.
  '[image: …]' placeholders and '*' emphasis marks are also no
  longer read aloud."
- `google_api/AGENTS.md` — two edits:
  - `text_to_audio` bullet (~line 45): "Renders over
    `AUDIO_FILE_MAX_BYTES` (1 MB)" → "(4 MB)".
  - Gotchas (~line 92): "a render over the 1 MB output cap" →
    "the 4 MB output cap".
- `google_api/README.md` — grep for `1 MB` / `MAX_BYTES`; update
  if mentioned (none found at planning time).
- `gmail/AGENTS.md` — no cap mention; no edit needed.

## Out of scope

- Pre-render size estimation (see Alternatives).
- `get_user_credentials` `TransportError`/unguarded save —
  separate follow-up.
- Re-enabling or deleting the commented-out `/text-to-audio`
  view/route.
- Any frontend code or constant changes.

## Test plan

Keep passing: `python manage.py test google_api` (all
`TextToAudio*` classes), `python manage.py test gmail` (audio
ops at tests.py:424-459), `python manage.py test single_pages`
(tts op tests) — all mock `text_to_audio` or the pipeline, so
the constant change is invisible to them.

Frontend: no files change, so `useAudioQueue.test.tsx` needs no
edits — it asserts against the `MAX_AUDIO_TEXT_LENGTH` constant
at line 131, not the literal. CI's vitest run stays green.

## Verification commands

```bash
source venv/bin/activate
python manage.py check
python manage.py test google_api
python manage.py test gmail
python manage.py test single_pages
awk 'length > 79 {print FILENAME":"NR}' \
    google_api/utils.py google_api/tests.py \
    docs/plans/gmail-audio-size-cap-plan.md
```

(No frontend changes → no lint/format/typecheck needed beyond
what CI runs anyway. `python manage.py export_openapi_schema`
output is unchanged — no API shape changes.)

## PR / UI verification section

PR body must include the UI verification steps (repo rule):

1. Run the app, open `/gmail/`, fetch unread messages.
2. Click Play (or Play All From Here) on an email whose body is
   > ~1900 chars — e.g. the "Spring prayer update from the
   Bourbeaus" message (2333 chars).
3. Expected: audio generates and plays; no `audioFailed` toast.
   Previously: 400 on `GET /api/gmail/audio/` → warning toast.
4. On an email with inline images / `*emphasis*`, confirm the
   reader no longer speaks "[image: …]" or "asterisk".
