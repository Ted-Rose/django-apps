# GCP Cloud Storage Migration Plan
## Audio Files Storage with 7-Day Auto-Deletion

**Date:** 2026-08-28  
**Objective:** Migrate audio file storage from local disk to GCP Cloud 
Storage with automatic 7-day lifecycle deletion

---

## Current State Analysis

### Current Implementation
- **Location:** `google_api/utils.py` - `text_to_audio()` function 
(lines 36-60)
- **Storage:** Local filesystem at `MEDIA_ROOT/recordings/` 
(`media/recordings/`)
- **File Type:** MP3 audio files generated via gTTS (Google 
Text-to-Speech)
- **Serving:** Django static file serving via `MEDIA_URL` (`/media/`)
- **Lifecycle:** No automatic deletion - files persist indefinitely
- **Issues:**
  - Cloud Run containers are ephemeral - files lost on restart
  - No scalability across multiple instances
  - No automatic cleanup
  - Disk space concerns

### Current Terraform Configuration
- **Project:** Uses GCP with Cloud Run deployment
- **Enabled APIs:** `storage.googleapis.com` already enabled 
(main.tf:31)
- **Service Accounts:**
  - `cloudrun-sa` - Cloud Run service account (iam.tf:5-12)
  - `github-deployer` - Deployment account with `storage.admin` role 
(iam.tf:44-49)
- **Existing Buckets:** Only `terraform_state` bucket for Terraform 
state (state_bucket.tf)

---

## Proposed Solution

### Architecture Overview
```
User Request → Django View → text_to_audio() → GCP Cloud Storage
                                                      ↓
                                                Signed URL (7-day TTL)
                                                      ↓
                                                User receives URL
                                                      ↓
                                          Lifecycle Policy deletes 
                                          after 7 days
```

### Key Components

1. **New GCP Cloud Storage Bucket**
   - Name: `{project_id}-audio-recordings`
   - Location: `upper(var.region)` → `EUROPE-WEST3` (matches Cloud Run region)
   - Lifecycle policy: Delete objects after 7 days
   - Public access: Disabled (use signed URLs)

2. **IAM Permissions**
   - Grant Cloud Run service account `storage.objectCreator` and 
`storage.objectViewer` roles
   - Scoped to the audio recordings bucket only

3. **Django Application Changes**
   - Add `google-cloud-storage` Python library
   - Modify `text_to_audio()` to upload to GCS
   - Generate signed URLs for client access (7-day expiry)
   - Remove local file storage logic

4. **Environment Configuration**
   - Add `GCS_AUDIO_BUCKET` environment variable to Cloud Run

---

## Implementation Plan

### Phase 1: Terraform Infrastructure (30 min)

#### 1.1 Create Audio Storage Bucket
**File:** `terraform/audio_storage.tf` (new file)

```hcl
# GCS bucket for audio recordings with 7-day lifecycle
resource "google_storage_bucket" "audio_recordings" {
  name                        = "${var.project_id}-audio-recordings"
  location                    = upper(var.region)
  project                     = var.project_id
  force_destroy               = true
  uniform_bucket_level_access = true

  # Automatic deletion after 7 days
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  # CORS configuration for browser access
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.enabled]
}
```

#### 1.2 Grant Cloud Run Service Account Permissions
**File:** `terraform/iam.tf` (append)

```hcl
# Cloud Run SA can write audio files to bucket
resource "google_storage_bucket_iam_member" "cloudrun_audio_object_creator" {
  bucket = google_storage_bucket.audio_recordings.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Cloud Run SA can read audio files (for signed URL generation)
resource "google_storage_bucket_iam_member" "cloudrun_audio_object_viewer" {
  bucket = google_storage_bucket.audio_recordings.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.cloudrun.email}"
}

# Cloud Run SA can sign blobs on its own behalf (required for
# generate_signed_url on Cloud Run where no private key is available)
resource "google_service_account_iam_member" "cloudrun_self_sign" {
  service_account_id = google_service_account.cloudrun.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.cloudrun.email}"
}
```

#### 1.3 Add Bucket Name to Cloud Run Environment
**File:** `terraform/cloud_run.tf` (add to env block)

```hcl
env {
  name  = "GCS_AUDIO_BUCKET"
  value = google_storage_bucket.audio_recordings.name
}
```

#### 1.4 Output Bucket Information
**File:** `terraform/outputs.tf` (append)

```hcl
output "audio_storage_bucket" {
  description = "GCS bucket for audio recordings"
  value       = google_storage_bucket.audio_recordings.name
}

output "audio_storage_bucket_url" {
  description = "GCS bucket URL"
  value       = google_storage_bucket.audio_recordings.url
}
```

#### 1.5 Deploy Terraform Changes
```bash
cd terraform
terraform plan
terraform apply
```

---

### Phase 2: Django Application Changes (45 min)

#### 2.1 Update Dependencies
**File:** `requirements.txt` (add)

```
google-cloud-storage==2.19.0
```

> **Note:** `2.19.0` is the latest stable 2.x release. Version 3.x
> introduced breaking API changes; pin to `2.19.0` until the rest of the
> dependencies are ready for a 3.x upgrade.

#### 2.2 Modify Audio Generation Function
**File:** `google_api/utils.py`

**Replace `text_to_audio()` function (lines 36-60) with:**

```python
import tempfile
import google.auth
import google.auth.transport.requests
from google.cloud import storage
from datetime import timedelta

def text_to_audio(text: str, lang: str = None,
                  filename: str = None) -> str:
    """
    Generate audio from text and upload to GCS.
    Returns a signed URL valid for 7 days.
    """
    DetectorFactory.seed = 0
    if lang is None:
        lang = detect(text)
        print("\n\n\nset lang to: ", lang)
        # Sometimes by mistake English is mistaken as German or Danish
        if lang not in ['lv', 'en']:
            lang = 'en'

    # Replace URLs with the word "web link"
    text = re.sub(r'https?://\S+', 'web link', text)
    # Remove long dashes
    text = re.sub(r'-{2,}', '', text)

    base = 'message_audio' if filename is None else str(filename)
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    unique_filename = f"{timestamp}_{base}.mp3"

    # Get GCS bucket name from environment
    bucket_name = os.environ.get('GCS_AUDIO_BUCKET')
    if not bucket_name:
        logger.error('GCS_AUDIO_BUCKET environment variable not set')
        raise ValueError('GCS_AUDIO_BUCKET not configured')

    # Obtain ADC credentials and refresh so the access token is
    # current — required for token-based signed URL generation on
    # Cloud Run (no private key is available via metadata server).
    credentials, _ = google.auth.default()
    credentials.refresh(google.auth.transport.requests.Request())

    # Initialize GCS client
    storage_client = storage.Client(credentials=credentials)
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(f"recordings/{unique_filename}")

    # Generate audio and upload via a temp file (gTTS needs a path)
    audio = gTTS(text=text, lang=lang, slow=False)
    with tempfile.NamedTemporaryFile(
        suffix='.mp3', delete=False
    ) as tmp_file:
        tmp_path = tmp_file.name
        audio.save(tmp_path)

    try:
        blob.upload_from_filename(tmp_path, content_type='audio/mpeg')
        logger.info(f'Uploaded audio to GCS: {unique_filename}')
    finally:
        os.unlink(tmp_path)

    # Generate signed URL valid for 7 days.
    # Pass service_account_email + access_token so the GCS client
    # calls the IAM signBlob API instead of trying to use a local
    # private key (which is not present on Cloud Run).
    signed_url = blob.generate_signed_url(
        version="v4",
        expiration=timedelta(days=7),
        method="GET",
        service_account_email=credentials.service_account_email,
        access_token=credentials.token,
    )

    return signed_url
```

**Key Changes:**
- Upload files to GCS instead of local disk
- Generate unique filenames with timestamps (every call is unique —
  no `blob.exists()` check needed)
- Refresh ADC credentials explicitly so `access_token` is available
  for token-based signing on Cloud Run
- Pass `service_account_email` + `access_token` to
  `generate_signed_url` — avoids the "no private key" error that
  occurs when using bare Compute Engine credentials
- Return signed URLs instead of local URLs
- Use temporary files for upload (gTTS requires a file path)
- 7-day signed URL expiration matches lifecycle policy

#### 2.3 Update Settings (Optional)
**File:** `django_apps/settings.py`

Add GCS configuration (lines 195-200):

```python
# GCS Configuration for audio storage
GCS_AUDIO_BUCKET = os.environ.get('GCS_AUDIO_BUCKET', '')
if GCS_AUDIO_BUCKET:
    logger.info(f'GCS Audio Bucket: {GCS_AUDIO_BUCKET}')
else:
    logger.warning('GCS_AUDIO_BUCKET not configured')
```

#### 2.4 Remove Local Media Configuration (Optional Cleanup)
Since audio files will be in GCS, the local `MEDIA_ROOT/recordings/` 
directory is no longer needed. However, keep `MEDIA_ROOT` if other 
parts of the app use it.

**Files to update (optional):**
- `.gitignore` - Remove `media/recordings/*` entries
- `.dockerignore` - Remove `media/recordings/*` entries

---

### Phase 3: Testing & Validation (30 min)

#### 3.1 Local Testing
```bash
# Set environment variable
export GCS_AUDIO_BUCKET="your-project-id-audio-recordings"

# Run Django locally
python manage.py runserver

# Test audio generation endpoint
curl "http://localhost:8000/text-to-audio?text=Hello%20World&filename=test"
```

**Expected Result:**
- Returns JSON with signed GCS URL
- URL format: `https://storage.googleapis.com/...`
- URL accessible for 7 days

#### 3.2 Deploy to Cloud Run
```bash
# Build and push Docker image
docker build -t us-central1-docker.pkg.dev/YOUR_PROJECT/
gae-standard/django-apps:latest .
docker push us-central1-docker.pkg.dev/YOUR_PROJECT/
gae-standard/django-apps:latest

# Deploy via GitHub Actions or manual
gcloud run deploy django-apps --region us-central1
```

#### 3.3 Verify GCS Bucket
```bash
# List files in bucket
gsutil ls gs://YOUR_PROJECT-audio-recordings/recordings/

# Check lifecycle policy
gsutil lifecycle get gs://YOUR_PROJECT-audio-recordings/
```

**Expected Output:**
```json
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"age": 7}
      }
    ]
  }
}
```

#### 3.4 Test Lifecycle Deletion
```bash
# Upload test file with past creation date (requires gsutil)
echo "test" > test.mp3
gsutil cp test.mp3 gs://YOUR_PROJECT-audio-recordings/recordings/

# Check file age
gsutil ls -L gs://YOUR_PROJECT-audio-recordings/recordings/test.mp3

# Wait 7 days or manually set object creation time for testing
# File should auto-delete after 7 days
```

---

### Phase 4: Monitoring & Cleanup (15 min)

#### 4.1 Add Logging
Monitor GCS operations in Cloud Run logs:
```bash
gcloud logging read "resource.type=cloud_run_revision AND 
textPayload=~\"GCS\"" --limit 50
```

#### 4.2 Set Up Alerts (Optional)
Create alerts for:
- Failed GCS uploads
- Signed URL generation errors
- Bucket quota exceeded

#### 4.3 Clean Up Old Local Files
Remove any existing local audio files:
```bash
rm -rf media/recordings/*.mp3
```

---

## Rollback Plan

If issues occur, rollback steps:

### 1. Revert Django Code
```bash
git revert <commit-hash>
git push
```

### 2. Redeploy Previous Version
```bash
gcloud run deploy django-apps --image=<previous-image-tag> 
--region us-central1
```

### 3. Keep Infrastructure
- Keep GCS bucket (no cost for empty bucket)
- Remove later if not needed:
  ```bash
  cd terraform
  terraform destroy -target=google_storage_bucket.audio_recordings
  ```

---

## Cost Estimation

### GCS Storage Costs (US-CENTRAL1)
- **Storage:** $0.020 per GB/month
- **Class A Operations (uploads):** $0.05 per 10,000 operations
- **Class B Operations (downloads):** $0.004 per 10,000 operations
- **Network Egress:** First 1 GB free, then $0.12/GB

### Example Scenario
- 1,000 audio files/month @ 100KB each = 100 MB
- Storage: 100 MB × $0.020/GB = $0.002/month
- Uploads: 1,000 × $0.05/10,000 = $0.005/month
- Downloads: 1,000 × $0.004/10,000 = $0.0004/month
- **Total: ~$0.01/month** (negligible)

### Lifecycle Deletion
- Automatic deletion after 7 days reduces storage costs
- No charges for deletion operations

---

## Security Considerations

### 1. Signed URLs
- **Expiration:** 7 days (matches lifecycle policy)
- **Access:** Read-only (GET method)
- **Scope:** Single object per URL
- **Rotation:** New URL generated for each request

### 2. IAM Permissions
- **Principle of Least Privilege:** Cloud Run SA only has 
`objectCreator` and `objectViewer`
- **Bucket-Scoped:** Permissions limited to audio bucket only
- **No Public Access:** Bucket not publicly accessible

### 3. CORS Configuration
- **Origins:** Currently set to `*` for flexibility
- **Recommendation:** Restrict to your domain in production:
  ```hcl
  origin = ["https://your-domain.com"]
  ```

---

## Migration Checklist

- [ ] **Phase 1: Terraform**
  - [ ] Create `terraform/audio_storage.tf`
  - [ ] Update `terraform/iam.tf` with bucket IAM bindings +
        `cloudrun_self_sign` (`roles/iam.serviceAccountTokenCreator`)
  - [ ] Update `terraform/cloud_run.tf` with `GCS_AUDIO_BUCKET` env var
  - [ ] Update `terraform/outputs.tf` with bucket outputs
  - [ ] Run `terraform plan` and review changes
  - [ ] Run `terraform apply` and verify bucket creation
  - [ ] Verify lifecycle policy: `gsutil lifecycle get gs://BUCKET_NAME`

- [ ] **Phase 2: Django Application**
  - [ ] Add `google-cloud-storage==2.19.0` to `requirements.txt`
  - [ ] Update `google_api/utils.py` - replace `text_to_audio()` function
  - [ ] Add GCS configuration to `django_apps/settings.py` (optional)
  - [ ] Test locally with `GCS_AUDIO_BUCKET` env var set
  - [ ] Commit and push changes

- [ ] **Phase 3: Deployment**
  - [ ] Build new Docker image with updated dependencies
  - [ ] Push to Artifact Registry
  - [ ] Deploy to Cloud Run (automatic via GitHub Actions or manual)
  - [ ] Verify `GCS_AUDIO_BUCKET` env var in Cloud Run console
  - [ ] Test audio generation endpoint in production

- [ ] **Phase 4: Validation**
  - [ ] Generate test audio file via production endpoint
  - [ ] Verify file appears in GCS bucket
  - [ ] Verify signed URL is accessible
  - [ ] Check Cloud Run logs for GCS operations
  - [ ] Monitor for 7 days to confirm lifecycle deletion

- [ ] **Phase 5: Cleanup (Optional)**
  - [ ] Remove local `media/recordings/` references from 
`.gitignore`
  - [ ] Remove local `media/recordings/` references from 
`.dockerignore`
  - [ ] Delete old local audio files
  - [ ] Update documentation

---

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Terraform Infrastructure | 30 min | None |
| Phase 2: Django Application | 45 min | Phase 1 complete |
| Phase 3: Testing & Validation | 30 min | Phase 2 complete |
| Phase 4: Monitoring & Cleanup | 15 min | Phase 3 complete |
| **Total** | **~2 hours** | |

---

## Success Criteria

✅ **Infrastructure:**
- GCS bucket created with 7-day lifecycle policy
- Cloud Run SA has correct IAM permissions
- `GCS_AUDIO_BUCKET` env var configured in Cloud Run

✅ **Application:**
- Audio files upload to GCS successfully
- Signed URLs returned to clients
- URLs accessible for 7 days
- No errors in Cloud Run logs

✅ **Lifecycle:**
- Files automatically deleted after 7 days
- No manual cleanup required
- Storage costs remain minimal

---

## Future Enhancements

1. **Caching:** Cache generated audio files by text hash to avoid 
regeneration
2. **CDN:** Add Cloud CDN for faster global delivery
3. **Compression:** Use Cloud Storage's automatic compression
4. **Monitoring:** Add Cloud Monitoring dashboards for GCS metrics
5. **Backup:** Enable object versioning for accidental deletion 
recovery (conflicts with lifecycle policy)
6. **Multi-Region:** Use multi-region bucket for higher availability

---

## References

- [GCS Lifecycle Management](https://cloud.google.com/storage/docs/
lifecycle)
- [GCS Signed URLs](https://cloud.google.com/storage/docs/
access-control/signed-urls)
- [google-cloud-storage Python Client](https://cloud.google.com/
python/docs/reference/storage/latest)
- [Cloud Run Environment Variables](https://cloud.google.com/run/docs/
configuring/environment-variables)

---

---

## ADDENDUM: Streaming vs. Signed URL Approach

### Question: Should we stream audio files through Django instead of 
using signed URLs?

### Current Client-Side Flow
The frontend (gmail.html) currently:
1. Calls `/text-to-audio?text=...&filename=...`
2. Receives JSON: `{"audio_url": "/media/recordings/file.mp3"}`
3. Sets `<audio src="...">` to the URL
4. Browser fetches audio directly from the URL

---

### Option A: Signed URLs (Proposed in Main Plan)

**How it works:**
```
Client → Django → GCS (upload) → Return signed URL → Client 
→ GCS (direct download)
```

**Pros:**
- ✅ **Simple implementation** - minimal code changes
- ✅ **Offloads bandwidth** - GCS serves files, not Django
- ✅ **Better performance** - Direct GCS download (no Django proxy)
- ✅ **Scalability** - Django doesn't handle file transfer
- ✅ **Lower Cloud Run costs** - No egress through Cloud Run
- ✅ **Built-in CDN** - GCS has global edge caching
- ✅ **No timeout issues** - Large files don't tie up Django workers
- ✅ **Browser caching** - Standard HTTP caching works

**Cons:**
- ❌ **Exposes GCS URLs** - Users see `storage.googleapis.com` URLs
- ❌ **Less control** - Can't easily track downloads
- ❌ **URL sharing** - Signed URLs can be shared (until expiry)

**Complexity:** ⭐ Low (already in main plan)

---

### Option B: Streaming Through Django

**How it works:**
```
Client → Django → GCS (download to memory) → Stream to Client
```

**Implementation:**

```python
from google.cloud import storage
from django.http import StreamingHttpResponse
import io

def audio_stream(request):
    """Stream audio file from GCS through Django"""
    if request.method == 'GET':
        text = request.GET.get('text')
        filename = request.GET.get('filename')
        lang = request.GET.get('lang')
        
        # Generate audio and upload to GCS (same as before)
        blob = generate_and_upload_audio(text, lang, filename)
        
        # Stream from GCS through Django
        def file_iterator(blob, chunk_size=8192):
            """Generator to stream file in chunks"""
            stream = io.BytesIO()
            blob.download_to_file(stream)
            stream.seek(0)
            while True:
                chunk = stream.read(chunk_size)
                if not chunk:
                    break
                yield chunk
        
        response = StreamingHttpResponse(
            file_iterator(blob),
            content_type='audio/mpeg'
        )
        response['Content-Disposition'] = 
f'inline; filename="{filename}.mp3"'
        response['Content-Length'] = blob.size
        
        # Enable browser caching
        response['Cache-Control'] = 'public, max-age=604800'  
# 7 days
        
        return response
```

**Pros:**
- ✅ **Full control** - Track every download, add analytics
- ✅ **URL consistency** - URLs stay on your domain
- ✅ **Access control** - Can add custom auth/rate limiting
- ✅ **No URL sharing** - Each request requires Django auth
- ✅ **Transparent to client** - No code changes needed

**Cons:**
- ❌ **Higher complexity** - More code to maintain
- ❌ **Performance overhead** - Django proxies every byte
- ❌ **Higher Cloud Run costs** - Egress through Cloud Run instances
- ❌ **Scalability concerns** - Django workers busy streaming files
- ❌ **Timeout risks** - Large files or slow connections may timeout
- ❌ **Memory usage** - Each stream uses Django worker memory
- ❌ **No CDN benefits** - Files served from single region

**Complexity:** ⭐⭐⭐ Medium-High

---

### Option C: Hybrid Approach (Best of Both Worlds)

**How it works:**
```
Client → Django (auth check) → Return signed URL → Client → GCS 
(direct download)
```

**Implementation:**

```python
def audio(request):
    """Generate audio and return signed URL with optional auth"""
    if request.method == 'GET':
        # Optional: Add authentication check
        # if not request.user.is_authenticated:
        #     return JsonResponse({'error': 'Unauthorized'}, 
status=401)
        
        text = request.GET.get('text')
        filename = request.GET.get('filename')
        lang = request.GET.get('lang')
        
        # Generate and upload to GCS
        signed_url = text_to_audio(text=text, lang=lang, 
filename=filename)
        
        # Optional: Log download request for analytics
        logger.info(f'Audio requested: {filename} by 
{request.user.email}')
        
        # Return signed URL (client downloads directly from GCS)
        return JsonResponse({'audio_url': signed_url})
```

**Pros:**
- ✅ **Simple like Option A** - Minimal code
- ✅ **Performance like Option A** - Direct GCS downloads
- ✅ **Auth control** - Can require login before URL generation
- ✅ **Analytics** - Track URL generation (not downloads)
- ✅ **Low cost** - No egress through Cloud Run

**Cons:**
- ❌ **Can't track actual downloads** - Only URL generation
- ❌ **URLs can be shared** - Once generated, anyone with URL can 
access (for 7 days)

**Complexity:** ⭐⭐ Low-Medium

---

### Recommendation: **Option A (Signed URLs)** ✅

**Reasoning:**

1. **Your Current Use Case:**
   - Audio files are small (~100KB MP3s from gTTS)
   - Users are already authenticated (Google OAuth)
   - No sensitive content requiring strict access control
   - Files auto-delete after 7 days anyway

2. **Performance & Cost:**
   - Streaming 100KB files through Django is overkill
   - GCS signed URLs are designed for this exact use case
   - Lower Cloud Run costs (no egress bandwidth)
   - Better user experience (faster downloads, CDN benefits)

3. **Simplicity:**
   - Less code = fewer bugs
   - Standard GCS pattern
   - No worker blocking issues

4. **When to Consider Streaming (Option B):**
   - Large files (>10MB) that need progress tracking
   - Highly sensitive content requiring per-download auth
   - Need to track actual downloads (not just URL generation)
   - Custom DRM or watermarking requirements
   - Rate limiting per user

---

### Complexity Comparison

| Aspect | Signed URLs | Streaming | Hybrid |
|--------|-------------|-----------|--------|
| Code Changes | Minimal | Moderate | Minimal |
| Performance | Excellent | Good | Excellent |
| Scalability | Excellent | Fair | Excellent |
| Cost | Low | Medium | Low |
| Control | Medium | High | Medium-High |
| Maintenance | Low | Medium | Low |
| **Overall** | ⭐ | ⭐⭐⭐ | ⭐⭐ |

---

### Migration Path if You Change Your Mind

If you start with **signed URLs** and later need **streaming**, the 
migration is straightforward:

1. **Keep GCS storage** - Files already in GCS
2. **Change view function** - Replace signed URL generation with 
streaming
3. **No client changes** - Frontend still gets a URL to use in 
`<audio src="">`

**Example migration:**
```python
# Before (signed URL)
return JsonResponse({'audio_url': signed_url})

# After (streaming through Django)
return JsonResponse({'audio_url': f'/audio-stream/{blob_name}/'})

# New streaming endpoint
def audio_stream(request, blob_name):
    # Stream from GCS as shown in Option B
    ...
```

---

### Final Recommendation

**Stick with the main plan (Signed URLs)** because:

1. ✅ Your files are small (100KB)
2. ✅ No sensitive content requiring strict download control
3. ✅ Better performance and lower costs
4. ✅ Simpler implementation and maintenance
5. ✅ Easy to migrate to streaming later if needed

**Only add streaming if:**
- You need to track actual downloads (not just URL generation)
- You need per-download authentication
- You have compliance requirements preventing direct GCS access
- You need custom headers/transformations per download

For your Gmail-to-audio use case, **signed URLs are the right 
choice**. 🎯

---

---

## ADDENDUM 2: Code Refactoring Opportunities

### Question: Should we refactor the existing code while migrating to 
GCS?

**Short Answer:** **YES** - There are several code quality issues that 
should be addressed. Since we're already modifying `text_to_audio()`, 
it's the perfect time to refactor.

---

### Current Code Quality Issues

#### 1. **Mixed Concerns in `utils.py`** 🔴 High Priority
**Problem:** Single file contains 286 lines with multiple unrelated 
responsibilities:
- Audio generation (`text_to_audio`)
- HTML parsing (`extract_text_from_html`)
- OAuth authentication (`google_auth`, `callback`)
- Gmail API (`get_messages`)
- Generic Google service builder (`build_google_service`)
- Hardcoded e-klase email parsing (lines 184-205)

**Impact:** Hard to test, maintain, and understand

---

#### 2. **Poor Error Handling** 🔴 High Priority
**Problems:**
- Line 40: `print("\n\n\nset lang to: ", lang)` - Debug print in 
production
- Line 156: `print("No messages found.")` - Print instead of logging
- Line 216: Generic `print(f"An error occurred: {error}")` - Loses 
error context
- Line 282: Bare `except Exception` - Swallows all errors
- No validation of required parameters in `text_to_audio()`

**Impact:** Hard to debug production issues

---

#### 3. **Hardcoded Business Logic** 🟡 Medium Priority
**Problem:** Lines 184-205 contain hardcoded e-klase email parsing
```python
if sender == "e-klase <notifikacijas@e-klase.lv>":
    # 20+ lines of regex parsing specific to one email sender
```

**Impact:** Not reusable, violates single responsibility principle

---

#### 4. **Missing Type Hints** 🟡 Medium Priority
**Problem:** Inconsistent type hints
- `text_to_audio()` has type hints ✅
- `extract_text_from_html()` missing type hints ❌
- `google_auth()` missing type hints ❌
- `get_messages()` missing type hints ❌

**Impact:** Harder to catch bugs, poor IDE autocomplete

---

#### 5. **No Input Validation** 🔴 High Priority
**Problem:** `text_to_audio()` doesn't validate inputs
```python
def text_to_audio(text: str, lang: str = None, 
filename: str = None) -> str:
    # What if text is None or empty?
    # What if text is 10MB of data?
    DetectorFactory.seed = 0
    if lang is None:
        lang = detect(text)  # Will crash if text is None
```

**Impact:** Potential crashes, security issues

---

#### 6. **Inefficient File Handling** 🟡 Medium Priority
**Problem:** Lines 53-57 check if file exists before creating
```python
if not os.path.exists(audio_file_path):
    audio = gTTS(text=text, lang=lang, slow=False)
    audio.save(audio_file_path)
```

**Issues:**
- Race condition (file could be created between check and save)
- In Cloud Run, files disappear on restart anyway
- No cache invalidation strategy

**Impact:** Unreliable caching, wasted resources

---

#### 7. **Inconsistent Return Types** 🟡 Medium Priority
**Problem:** `google_auth()` returns different types
```python
def google_auth(creds=None, scopes=None):
    # Sometimes returns dict with 'authorization_url'
    return {"authorization_url": ..., "state": ..., "scopes": ...}
    # Sometimes returns Credentials object
    return creds
```

**Impact:** Callers must check type, error-prone

---

### Recommended Refactoring Plan

#### **Option A: Minimal Refactoring (During GCS Migration)** ⭐ 
Recommended

**Scope:** Fix only what we're touching for GCS migration
**Time:** +30 minutes to migration
**Risk:** Low

**Changes:**
1. ✅ Refactor `text_to_audio()` properly
2. ✅ Add input validation
3. ✅ Replace `print()` with `logger` in audio function
4. ✅ Add proper error handling
5. ❌ Leave other functions as-is (separate refactor later)

---

#### **Option B: Comprehensive Refactoring** ⭐⭐⭐

**Scope:** Restructure entire `google_api` module
**Time:** +4-6 hours
**Risk:** Medium (more code changes = more testing needed)

**Changes:**
1. Split `utils.py` into focused modules:
   ```
   google_api/
   ├── services/
   │   ├── __init__.py
   │   ├── audio.py          # text_to_audio, GCS upload
   │   ├── gmail.py          # get_messages, email parsing
   │   ├── auth.py           # google_auth, callback
   │   └── parsers/
   │       ├── __init__.py
   │       ├── base.py       # Base email parser
   │       └── eklase.py     # E-klase specific parser
   ├── utils.py              # Generic utilities (HTML parsing)
   └── views.py
   ```

2. Add proper error handling throughout
3. Add comprehensive type hints
4. Add input validation
5. Write unit tests
6. Add docstrings

---

### Recommended Approach: **Option A + Future Option B**

**Phase 1: During GCS Migration (Option A)**
Refactor only `text_to_audio()` properly:

```python
# google_api/utils.py (improved version)
# Top-of-file imports — add these alongside the existing ones:
#
#   import tempfile
#   import google.auth
#   import google.auth.transport.requests
#   from typing import Optional
#   from google.cloud import storage
#   from datetime import timedelta
#   from langdetect import detect, DetectorFactory, LangDetectException
#
# (re, os, datetime, logging are already imported at module level)

import logging
import os
import re
import tempfile
from datetime import datetime, timedelta
from typing import Optional

import google.auth
import google.auth.transport.requests
from google.cloud import storage
from gtts import gTTS
from langdetect import detect, DetectorFactory, LangDetectException

logger = logging.getLogger('django')


class AudioGenerationError(Exception):
    """Raised when audio generation fails"""
    pass


def text_to_audio(
    text: str,
    lang: Optional[str] = None,
    filename: Optional[str] = None,
) -> str:
    """
    Generate audio from text and upload to GCS.

    Args:
        text: Text to convert to audio (max 5000 chars)
        lang: Language code (auto-detected if None)
        filename: Base filename without extension
                  (auto-generated if None)

    Returns:
        Signed GCS URL valid for 7 days

    Raises:
        AudioGenerationError: If audio generation or upload fails
        ValueError: If inputs are invalid
    """
    # Input validation
    if not text or not isinstance(text, str):
        raise ValueError("Text must be a non-empty string")

    if len(text) > 5000:
        raise ValueError("Text too long (max 5000 characters)")

    # Detect language
    DetectorFactory.seed = 0
    if lang is None:
        try:
            lang = detect(text)
            logger.info(f"Detected language: {lang}")
            # Sometimes English is mistaken as German or Danish
            if lang not in ['lv', 'en']:
                lang = 'en'
                logger.info("Defaulting to English")
        except LangDetectException as e:
            logger.warning(
                f"Language detection failed: {e}, defaulting to English"
            )
            lang = 'en'

    # Sanitize text
    text = _sanitize_text_for_audio(text)

    # Generate unique filename (timestamp + microseconds avoids
    # collisions; no blob.exists() check needed)
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')
    if filename:
        # Sanitize to prevent path traversal
        safe_filename = "".join(
            c for c in str(filename) if c.isalnum() or c in ('-', '_')
        )
        unique_filename = f"{timestamp}_{safe_filename}.mp3"
    else:
        unique_filename = f"{timestamp}_message_audio.mp3"

    # Get GCS bucket
    bucket_name = os.environ.get('GCS_AUDIO_BUCKET')
    if not bucket_name:
        logger.error('GCS_AUDIO_BUCKET environment variable not set')
        raise AudioGenerationError('GCS storage not configured')

    try:
        # Refresh ADC credentials so access_token is current.
        # On Cloud Run there is no private key — signed URLs must
        # use the IAM signBlob API via service_account_email +
        # access_token.
        credentials, _ = google.auth.default()
        credentials.refresh(google.auth.transport.requests.Request())

        storage_client = storage.Client(credentials=credentials)
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(f"recordings/{unique_filename}")

        # Generate audio and upload via a temp file (gTTS needs a path)
        audio = gTTS(text=text, lang=lang, slow=False)
        with tempfile.NamedTemporaryFile(
            suffix='.mp3', delete=False
        ) as tmp_file:
            tmp_path = tmp_file.name
            audio.save(tmp_path)

        try:
            blob.upload_from_filename(
                tmp_path,
                content_type='audio/mpeg',
                timeout=30,
            )
            logger.info(f'Uploaded audio to GCS: {unique_filename}')
        finally:
            os.unlink(tmp_path)

        # Generate signed URL valid for 7 days
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(days=7),
            method="GET",
            service_account_email=credentials.service_account_email,
            access_token=credentials.token,
        )

        return signed_url

    except Exception as e:
        logger.exception(f"Failed to generate audio: {e}")
        raise AudioGenerationError(f"Audio generation failed: {e}")


def _sanitize_text_for_audio(text: str) -> str:
    """
    Sanitize text for audio generation.

    Args:
        text: Raw text

    Returns:
        Sanitized text suitable for TTS
    """
    # Replace URLs with the word "web link"
    text = re.sub(r'https?://\S+', 'web link', text)

    # Remove long dashes
    text = re.sub(r'-{2,}', '', text)

    # Remove excessive whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    return text


# Keep other functions as-is for now
def extract_text_from_html(html_content):
    # ... existing code ...
```

**Improvements:**
- ✅ Proper input validation
- ✅ Custom exception for better error handling
- ✅ Complete type hints
- ✅ Comprehensive docstring
- ✅ Logging instead of print()
- ✅ Filename sanitization (security)
- ✅ Text length limit (prevent abuse)
- ✅ Proper error handling with context
- ✅ Helper function for text sanitization
- ✅ Timeout on GCS upload

---

**Phase 2: Future Refactoring (Option B)**
After GCS migration is stable, create a follow-up task to:
1. Split `utils.py` into focused modules
2. Extract e-klase parser to separate class
3. Add comprehensive tests
4. Improve `google_auth()` return type consistency
5. Add type hints to all functions

---

### Updated Migration Checklist with Refactoring

**Phase 2: Django Application (now 60 min instead of 45 min)**

- [ ] Add `google-cloud-storage==2.19.0` to `requirements.txt`
- [ ] **Refactor `text_to_audio()` with improvements:**
  - [ ] Add `google.auth`, `google.auth.transport.requests` imports
  - [ ] Add `LangDetectException` to the `langdetect` import line
  - [ ] Add input validation (text, length limits)
  - [ ] Add proper error handling with custom `AudioGenerationError`
  - [ ] Add complete type hints and docstring
  - [ ] Replace `print()` with `logger.info()`
  - [ ] Add filename sanitization
  - [ ] Extract `_sanitize_text_for_audio()` helper
  - [ ] Refresh ADC credentials and pass `service_account_email` +
        `access_token` to `generate_signed_url` (Cloud Run requirement)
  - [ ] Add GCS upload with timeout
  - [ ] Add comprehensive error logging
- [ ] Test locally with various inputs (empty, long, special chars)
- [ ] Commit and push changes

**Phase 5: Future Refactoring (Optional, separate task)**
- [ ] Create `google_api/services/` directory structure
- [ ] Split `utils.py` into focused modules
- [ ] Extract e-klase parser to `parsers/eklase.py`
- [ ] Add unit tests for all services
- [ ] Add integration tests
- [ ] Update imports in views.py

---

### Benefits of Refactoring During Migration

| Benefit | Impact |
|---------|--------|
| **Better error messages** | Easier debugging in production |
| **Input validation** | Prevents crashes from bad data |
| **Security** | Filename sanitization prevents path 
traversal |
| **Maintainability** | Clear separation of concerns |
| **Type safety** | Catch bugs before deployment |
| **Logging** | Better observability in Cloud Run |
| **Testing** | Easier to write unit tests |

---

### Code Quality Comparison

| Aspect | Before | After Refactor |
|--------|--------|----------------|
| Lines of code | 25 lines | ~80 lines (but much better) |
| Error handling | ❌ None | ✅ Comprehensive |
| Input validation | ❌ None | ✅ Yes |
| Type hints | ⚠️ Partial | ✅ Complete |
| Logging | ❌ print() | ✅ logger |
| Docstring | ❌ None | ✅ Detailed |
| Security | ⚠️ Risky | ✅ Sanitized |
| Testability | ❌ Hard | ✅ Easy |

---

### Recommendation: **Do Minimal Refactoring Now (Option A)** ✅

**Why:**
1. ✅ We're already touching `text_to_audio()` for GCS migration
2. ✅ Current code has serious issues (no validation, poor errors)
3. ✅ Only adds 30 minutes to migration time
4. ✅ Makes debugging much easier in production
5. ✅ Prevents security issues (filename sanitization)
6. ✅ Better foundation for future work

**Why not comprehensive refactoring now:**
1. ❌ Increases migration risk (more changes = more testing)
2. ❌ Delays GCS migration by several hours
3. ❌ Can be done separately after GCS is stable
4. ❌ Harder to isolate issues if something breaks

---

### Updated Timeline with Refactoring

| Phase | Duration | Change |
|-------|----------|--------|
| Phase 1: Terraform Infrastructure | 30 min | No change |
| Phase 2: Django Application + Refactoring | **60 min** | +15 min |
| Phase 3: Testing & Validation | **45 min** | +15 min (test 
edge cases) |
| Phase 4: Monitoring & Cleanup | 15 min | No change |
| **Total** | **~2.5 hours** | +30 min |

---

### Testing Checklist for Refactored Code

- [ ] **Valid inputs:**
  - [ ] Normal text (English)
  - [ ] Latvian text
  - [ ] Text with URLs
  - [ ] Text with special characters
  
- [ ] **Edge cases:**
  - [ ] Empty string → Should raise ValueError
  - [ ] None → Should raise ValueError
  - [ ] Very long text (>5000 chars) → Should raise ValueError
  - [ ] Text with path traversal attempt (`../../../etc/passwd`) → 
Should sanitize
  
- [ ] **Error scenarios:**
  - [ ] GCS_AUDIO_BUCKET not set → Should raise 
AudioGenerationError
  - [ ] GCS upload fails → Should raise AudioGenerationError with 
context
  - [ ] Language detection fails → Should default to English
  
- [ ] **Integration:**
  - [ ] Frontend still works with new signed URLs
  - [ ] Audio plays correctly in browser
  - [ ] Error messages appear in Cloud Run logs

---

### Final Recommendation

**YES, refactor during migration using Option A:**

1. ✅ Fix `text_to_audio()` properly (it needs it badly)
2. ✅ Add validation, error handling, logging
3. ✅ Only adds 30 minutes
4. ✅ Prevents production issues
5. ❌ Don't refactor entire `utils.py` yet (do later)

**Create a follow-up task for comprehensive refactoring (Option B)** 
after GCS migration is stable and proven in production.

---

**Document Version:** 1.3  
**Last Updated:** 2026-08-28  
**Author:** Migration Planning Assistant
