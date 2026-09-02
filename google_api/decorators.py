from functools import wraps
from django.shortcuts import redirect
from django.urls import reverse
import logging

logger = logging.getLogger('django')


def google_auth_required(scopes=None):
    """
    Decorator to ensure user has valid Google OAuth credentials.
    
    Usage:
        @google_auth_required()
        def my_view(request):
            ...
        
        @google_auth_required(scopes=['https://www.googleapis.com/auth/tasks'])
        def my_view(request):
            ...
    
    Args:
        scopes: Optional list of required OAuth scopes
    """
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(request, *args, **kwargs):
            from google_api.models import GoogleOAuthCredentials
            from google_api.utils import ALL_APP_SCOPES
            
            # Check if user is authenticated
            if not request.user.is_authenticated:
                logger.warning('User not authenticated, redirecting to login')
                next_url = request.get_full_path()
                return redirect(f"{reverse('google_api:login')}?next={next_url}")
            
            # Check if user has Google credentials
            try:
                oauth_creds = GoogleOAuthCredentials.objects.get(
                    user=request.user
                )
                
                # Check if required scopes are granted
                required_scopes = scopes or ALL_APP_SCOPES
                if not oauth_creds.has_all_scopes(required_scopes):
                    logger.warning(
                        f'User {request.user.username} missing required '
                        f'scopes. Required: {required_scopes}, '
                        f'Granted: {oauth_creds.scopes}'
                    )
                    next_url = request.get_full_path()
                    return redirect(
                        f"{reverse('google_api:login')}?next={next_url}"
                    )
                
            except GoogleOAuthCredentials.DoesNotExist:
                logger.warning(
                    f'No Google credentials for user {request.user.username}'
                )
                next_url = request.get_full_path()
                return redirect(f"{reverse('google_api:login')}?next={next_url}")
            
            return view_func(request, *args, **kwargs)
        
        return wrapper
    return decorator
