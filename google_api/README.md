# Gmail to Audio

Listen to your Gmail messages in audio format with a click of a button.

## Features

- **Gmail Integration**: Fetch and display Gmail messages via Google API
- **Text-to-Speech**: Convert email content to audio using Google TTS
- **Cloud Storage**: Audio files stored in GCP Cloud Storage with 
  automatic 7-day lifecycle deletion
- **Signed URLs**: Secure, time-limited access to audio files (7-day 
  expiry)
- **Language Detection**: Automatic language detection for proper 
  pronunciation
- **OAuth2 Authentication**: Secure Google account authentication

## Architecture

This app provides core Google API integration utilities used by other 
apps:
- **google_api**: OAuth2 authentication, Gmail API, and audio 
  generation utilities
- **google_tasks**: Task management (see separate README)

### Key Components

- **Models**: User authentication and session management
- **Services** (`utils.py`): Reusable Google API utilities
- **Views** (`views.py`): Gmail display and audio generation endpoints
- **Templates**: Bootstrap 5-based responsive UI

## Audio Generation Flow

### Current Implementation (GCP Cloud Storage)

```
User Request
    ↓
Django View (/text-to-audio)
    ↓
text_to_audio() function
    ↓
┌─────────────────────────────────────┐
│ 1. Input Validation                 │
│    - Check text is non-empty string │
│    - Validate length (max 5000)     │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 2. Language Detection               │
│    - Auto-detect language (lv/en)   │
│    - Fallback to English on error   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 3. Text Sanitization                │
│    - Replace URLs with "web link"   │
│    - Remove long dashes             │
│    - Normalize whitespace           │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 4. Generate Audio (gTTS)            │
│    - Create MP3 in temp file        │
│    - Unique filename with timestamp │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 5. Upload to GCS                    │
│    - Bucket: {project}-audio-       │
│      recordings                     │
│    - Path: recordings/{timestamp}_  │
│      {filename}.mp3                 │
│    - Content-Type: audio/mpeg       │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 6. Generate Signed URL              │
│    - Version: v4                    │
│    - Expiration: 7 days             │
│    - Method: GET                    │
│    - Token-based signing (Cloud Run)│
└─────────────────────────────────────┘
    ↓
Return JSON: {"audio_url": "https://storage.googleapis.com/..."}
    ↓
Client plays audio directly from GCS
    ↓
GCS Lifecycle Policy deletes file after 7 days
```

### Technical Details

**Storage Backend**: GCP Cloud Storage
- **Bucket**: `{project_id}-audio-recordings`
- **Region**: `EUROPE-WEST3` (matches Cloud Run)
- **Lifecycle**: Automatic deletion after 7 days
- **Access**: Signed URLs (no public access)

**Audio Generation**:
- **Library**: gTTS (Google Text-to-Speech)
- **Format**: MP3
- **Languages**: Auto-detected (Latvian/English)
- **Max Length**: 5000 characters

**Security**:
- Input validation (type, length)
- Filename sanitization (prevent path traversal)
- Text sanitization (URL replacement)
- Signed URLs with 7-day expiration
- IAM-based bucket access control

**Error Handling**:
- Custom `AudioGenerationError` exception
- Comprehensive logging
- Validation errors return HTTP 400
- Generation errors return HTTP 500

## URL Structure

| URL Pattern | View | Method | Description |
|------------|------|--------|-------------|
| `/gmail/` | `gmail` | GET | Gmail message list |
| `/text-to-audio` | `audio` | GET | Generate audio from text |
| `/google/auth` | `auth` | GET | Initiate OAuth2 flow |
| `/google/callback` | `callback` | GET | OAuth2 callback handler |

## API Endpoints

### Generate Audio
**Endpoint**: `/text-to-audio`  
**Method**: GET  
**Parameters**:
- `text` (required): Text to convert to audio (max 5000 chars)
- `lang` (optional): Language code ('lv' or 'en', auto-detected if 
  omitted)
- `filename` (optional): Base filename (sanitized automatically)

**Response**:
```json
{
  "audio_url": "https://storage.googleapis.com/bucket/recordings/
20260828_120000_123456_filename.mp3?X-Goog-Algorithm=..."
}
```

**Error Responses**:
- `400`: Invalid input (empty text, too long)
- `500`: Audio generation or upload failed

**Example**:
```bash
GET /text-to-audio?text=Hello%20World&filename=greeting
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GCS_AUDIO_BUCKET` | Yes | GCS bucket name for audio files |
| `GOOGLE_CLOUD_PROJECT` | Yes | GCP project ID |
| `GOOGLE_OAUTH_CLIENT_JSON` | Yes | OAuth2 client credentials |

## Authentication & Authorization

**OAuth2 Flow**:
1. User visits protected endpoint
2. Redirected to Google OAuth consent screen
3. User grants permissions
4. Callback receives authorization code
5. Exchange code for access/refresh tokens
6. Tokens stored in session
7. User redirected to original destination

**Required Scopes**:
- `openid` - User identity
- `https://www.googleapis.com/auth/userinfo.email` - Email address
- `https://www.googleapis.com/auth/gmail.readonly` - Gmail read access
- `https://www.googleapis.com/auth/tasks` - Google Tasks (if using 
  tasks app)

**Session Management**:
- Credentials stored in `request.session['google_credentials']`
- Automatic token refresh when expired
- Re-authentication flow if refresh fails

## Infrastructure (Terraform)

### GCS Bucket Configuration
```hcl
resource "google_storage_bucket" "audio_recordings" {
  name     = "${var.project_id}-audio-recordings"
  location = "EUROPE-WEST3"
  
  lifecycle_rule {
    condition { age = 7 }
    action { type = "Delete" }
  }
  
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }
}
```

### IAM Permissions
- **Cloud Run Service Account**:
  - `roles/storage.objectCreator` - Upload audio files
  - `roles/storage.objectViewer` - Read for signed URL generation
  - `roles/iam.serviceAccountTokenCreator` - Sign URLs without 
    private key

### Cloud Run Configuration
- Environment variable: `GCS_AUDIO_BUCKET` set to bucket name
- Service account: `cloudrun-sa@{project}.iam.gserviceaccount.com`

## Behavior Details

### Text Sanitization
**Performed by** `_sanitize_text_for_audio()`:
1. Replace URLs with "web link" (prevents TTS from reading long URLs)
2. Remove long dashes (improves audio quality)
3. Normalize whitespace (removes excessive spaces/newlines)

**Example**:
```python
Input:  "Check https://example.com for info----more text"
Output: "Check web link for info more text"
```

### Language Detection
**Auto-detection**:
- Uses `langdetect` library
- Supports Latvian (`lv`) and English (`en`)
- Falls back to English if:
  - Detection fails
  - Detected language is neither `lv` nor `en`
  - Language is mistakenly detected as German/Danish

**Manual Override**:
- Pass `lang` parameter to force specific language
- Useful for short texts where detection is unreliable

### Filename Generation
**Format**: `{timestamp}_{filename}.mp3`
- **Timestamp**: `YYYYMMDD_HHMMSS_microseconds` (ensures uniqueness)
- **Filename**: Sanitized user input or "message_audio"
- **Sanitization**: Only alphanumeric, hyphens, and underscores allowed

**Examples**:
- `20260828_143022_456789_greeting.mp3`
- `20260828_143022_456789_message_audio.mp3`

### Signed URL Generation
**Cloud Run Specifics**:
- No private key available on Cloud Run
- Uses IAM `signBlob` API instead
- Requires:
  - `service_account_email` from ADC credentials
  - `access_token` from refreshed credentials
  - `iam.serviceAccountTokenCreator` role

**URL Properties**:
- **Version**: v4 (latest signing version)
- **Expiration**: 7 days (matches lifecycle policy)
- **Method**: GET only
- **Format**: Query string with signature parameters

## Error Handling & Edge Cases

### Input Validation
- **Empty text**: Raises `ValueError`
- **Non-string text**: Raises `ValueError`
- **Text > 5000 chars**: Raises `ValueError`
- **Invalid filename**: Sanitized automatically

### GCS Operations
- **Bucket not configured**: Raises `AudioGenerationError`
- **Upload timeout**: 30 seconds (configurable)
- **Upload failure**: Logged and raises `AudioGenerationError`
- **Temp file cleanup**: Always deleted (even on error)

### Language Detection
- **Detection failure**: Logs warning, defaults to English
- **Ambiguous text**: Uses first detected language
- **Empty text**: Caught by input validation

### Authentication
- **Missing credentials**: Returns JSON error
- **Expired token**: Automatic refresh attempt
- **Refresh failure**: Redirects to OAuth flow
- **Invalid scope**: Re-authentication required

## Setup

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Configure OAuth2**:
   - Create OAuth2 credentials in Google Cloud Console
   - Download client secrets JSON
   - Set `GOOGLE_OAUTH_CLIENT_JSON` environment variable

3. **Configure GCS**:
   - Run Terraform to create bucket and IAM permissions
   - Set `GCS_AUDIO_BUCKET` environment variable

4. **Run Migrations**:
   ```bash
   python manage.py migrate
   ```

5. **Include URLs**:
   ```python
   path('', include('google_api.urls')),
   ```

## Usage

### Gmail to Audio
1. Navigate to `/gmail/`
2. Authenticate with Google (if not already authenticated)
3. View Gmail messages
4. Click "Listen" button to generate audio
5. Audio plays directly from GCS via signed URL

### Direct Audio Generation
```javascript
// JavaScript example
fetch('/text-to-audio?text=Hello%20World&filename=greeting')
  .then(response => response.json())
  .then(data => {
    const audio = new Audio(data.audio_url);
    audio.play();
  });
```

## Dependencies

All required dependencies are in `requirements.txt`:
- `google-api-python-client==2.136.0` - Google API client
- `google-auth==2.31.0` - Google authentication
- `google-auth-oauthlib==1.2.0` - OAuth2 flow
- `google-cloud-storage==2.19.0` - GCS client library
- `gtts==2.5.1` - Google Text-to-Speech
- `langdetect==1.0.9` - Language detection
- `beautifulsoup4==4.12.3` - HTML parsing

## Logging

Uses Django's logging framework:
- **Logger name**: `'django'`
- **Log levels**:
  - `INFO`: Language detection, successful uploads
  - `WARNING`: Language detection failures, missing config
  - `ERROR`: GCS configuration errors
  - `EXCEPTION`: Audio generation failures (with stack trace)

**Example logs**:
```
INFO: Detected language: lv
INFO: Uploaded audio to GCS: 20260828_143022_456789_greeting.mp3
WARNING: Language detection failed: No features in text, 
defaulting to English
ERROR: GCS_AUDIO_BUCKET environment variable not set
```

## Cost Estimation

### GCS Storage Costs (EUROPE-WEST3)
- **Storage**: €0.020 per GB/month
- **Class A Operations (uploads)**: €0.05 per 10,000 operations
- **Class B Operations (downloads)**: €0.004 per 10,000 operations
- **Network Egress**: First 1 GB free, then €0.12/GB

### Example Scenario
- 1,000 audio files/month @ 100KB each = 100 MB
- **Storage**: 100 MB × €0.020/GB = €0.002/month
- **Uploads**: 1,000 × €0.05/10,000 = €0.005/month
- **Downloads**: 1,000 × €0.004/10,000 = €0.0004/month
- **Total**: ~€0.01/month (negligible)

### Lifecycle Deletion
- Automatic deletion after 7 days reduces storage costs
- No charges for deletion operations

## Migration History

### v2.0 (2026-08-28) - GCP Cloud Storage Migration
**Previous**: Local filesystem storage at `MEDIA_ROOT/recordings/`  
**Current**: GCP Cloud Storage with signed URLs

**Benefits**:
- ✅ Files persist across Cloud Run container restarts
- ✅ Automatic cleanup after 7 days
- ✅ Scalable across multiple Cloud Run instances
- ✅ Better security and error handling
- ✅ Lower Cloud Run costs (direct GCS downloads)

**See**: `GCP_STORAGE_MIGRATION_PLAN.md` for detailed migration plan

## Future Enhancements

1. **Caching**: Cache generated audio by text hash to avoid 
   regeneration
2. **CDN**: Add Cloud CDN for faster global delivery
3. **Compression**: Use Cloud Storage's automatic compression
4. **Monitoring**: Add Cloud Monitoring dashboards for GCS metrics
5. **Multi-Region**: Use multi-region bucket for higher availability
6. **Streaming**: Add option to stream through Django for access 
   control
