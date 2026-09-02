# Google OAuth Implementation Guide

## Overview

This implementation provides a centralized Google OAuth authentication system 
that allows users to log in once and grant access to both Gmail (readonly) 
and Google Tasks APIs with long-lasting refresh tokens.

## Key Features

1. **Single Sign-On**: Users log in once and grant all necessary permissions
2. **Long-lasting Tokens**: Refresh tokens are stored in the database and 
   automatically refreshed when expired
3. **Database-backed Credentials**: Credentials persist across sessions
4. **Unified Scopes**: All required scopes are requested at once:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/tasks`

## Architecture

### Models

**GoogleOAuthCredentials** (`google_api/models.py`)
- Stores OAuth credentials for each user
- One-to-one relationship with Django User model
- Fields:
  - `access_token`: Current access token (expires ~1 hour)
  - `refresh_token`: Long-lasting refresh token
  - `token_expiry`: When the access token expires
  - `scopes`: List of granted OAuth scopes (JSON field)
  - `created_at`, `updated_at`: Timestamps

### Authentication Flow

1. **User visits protected page** → Redirected to `/login/`
2. **Login view** → Initiates OAuth flow with all required scopes
3. **User grants permissions** → Google redirects to `/google/callback`
4. **Callback handler**:
   - Exchanges authorization code for tokens
   - Creates/updates User account based on Google email
   - Saves credentials to database
   - Logs user in
   - Redirects to original destination

### Utility Functions

**`get_user_credentials(user, scopes=None)`** (`google_api/utils.py`)
- Retrieves credentials from database for a user
- Automatically refreshes expired tokens
- Returns `Credentials` object or `None`

**`google_auth(creds=None, scopes=None, user=None)`** (`google_api/utils.py`)
- Main authentication function
- Supports both database and session-based credentials
- Returns `Credentials` object or dict with `authorization_url` if reauth 
  needed

**`callback(request, scopes=None)`** (`google_api/utils.py`)
- Handles OAuth callback
- Saves credentials to database
- Creates/logs in user

### Decorators

**`@google_auth_required(scopes=None)`** (`google_api/decorators.py`)
- Ensures user is authenticated and has valid Google credentials
- Checks if required scopes are granted
- Redirects to login if credentials missing or scopes insufficient

### Views

**Gmail View** (`google_api/views.py`)
- Protected with `@google_auth_required` decorator
- Uses database credentials via `get_user_credentials()`
- Supports text-to-speech functionality

**Google Tasks Views** (`google_tasks/views.py`)
- All views updated to use `get_creds_dict()` helper
- Helper function retrieves credentials from database
- Maintains backward compatibility with existing code

## Usage

### For Users

1. Visit `/login/` or any protected page
2. Click "Sign in with Google"
3. Grant permissions for Gmail and Tasks
4. You're logged in and can access both services

### For Developers

#### Protecting a View

```python
from google_api.decorators import google_auth_required

@google_auth_required()
def my_view(request):
    # User is authenticated and has valid credentials
    pass

@google_auth_required(scopes=['https://www.googleapis.com/auth/tasks'])
def tasks_view(request):
    # User has specific scopes
    pass
```

#### Getting User Credentials

```python
from google_api.utils import get_user_credentials

def my_view(request):
    creds = get_user_credentials(
        request.user,
        scopes=['https://www.googleapis.com/auth/gmail.readonly']
    )
    
    if creds:
        # Use credentials with Google API
        service = build('gmail', 'v1', credentials=creds)
```

## Configuration

### Required Settings

In `settings.py`:
- `LOGIN_URL = '/login/'`
- `GOOGLE_APP_SECRETS_PATH`: Path to OAuth client secrets JSON

### OAuth Client Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials
3. Add authorized redirect URI: `{BASE_URL}/google/callback`
4. Download client secrets JSON
5. Save to `google_api/app_secrets.json` or path in 
   `GOOGLE_APP_SECRETS_PATH`

### Required Scopes

The application requests these scopes by default:
- `openid`: OpenID Connect
- `https://www.googleapis.com/auth/userinfo.email`: User email
- `https://www.googleapis.com/auth/gmail.readonly`: Read Gmail messages
- `https://www.googleapis.com/auth/tasks`: Full access to Google Tasks

## Token Refresh

Tokens are automatically refreshed when:
1. `get_user_credentials()` detects an expired token
2. The refresh is transparent to the application
3. Updated tokens are saved back to the database

## Security Considerations

1. **Refresh tokens** are stored in the database (ensure DB is secure)
2. **Access tokens** expire after ~1 hour
3. **Prompt=consent** ensures refresh token is always returned
4. **HTTPS required** in production (enforced by Google)
5. **Session security** for backward compatibility

## Migration from Session-based Auth

The implementation maintains backward compatibility:
- Session-based credentials still work
- New logins save to database
- Gradual migration as users re-authenticate

## Troubleshooting

### "No credentials found" error
- User needs to visit `/login/` to authenticate
- Check that `GoogleOAuthCredentials` exists for user

### "Missing scopes" error
- User needs to re-authenticate to grant additional scopes
- Visit `/login/` to trigger re-authentication

### Token refresh fails
- Refresh token may be revoked
- User needs to re-authenticate
- Check Google Cloud Console for API quotas

## Admin Interface

View and manage credentials at `/admin/google_api/googleoauthcredentials/`
- See which users have credentials
- Check token expiry
- View granted scopes

## Testing

1. Start development server: `python manage.py runserver`
2. Visit `http://localhost:8000/login/`
3. Complete OAuth flow
4. Check database for `GoogleOAuthCredentials` entry
5. Test Gmail view: `http://localhost:8000/gmail-to-audio`
6. Test Tasks view: `http://localhost:8000/tasks/`

## Future Enhancements

1. Add token revocation endpoint
2. Implement scope upgrade flow
3. Add credential health monitoring
4. Support multiple Google accounts per user
5. Add OAuth consent screen customization
