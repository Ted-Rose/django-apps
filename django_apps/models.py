"""Project-level models — django_apps is a regular app (in
INSTALLED_APPS) holding cross-app state like per-user settings."""
from django.conf import settings
from django.db import models


class UserSettings(models.Model):
    """Per-user site preferences (the SPAs' display language today).

    Server-side storage matters because cron jobs render push/in-app
    notification text for a user with no request context — a cookie
    or session alone could never reach them.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='settings',
    )
    language = models.CharField(
        max_length=8,
        choices=settings.LANGUAGES,
        default='en',
    )

    def __str__(self):
        return f'{self.user} — {self.language}'


def user_language(user):
    """The user's stored language code; 'en' when unset/anonymous.

    Read-only (no get_or_create): the reverse one-to-one accessor
    raises RelatedObjectDoesNotExist — an AttributeError subclass —
    so getattr's default covers users without a row, and
    AnonymousUser simply lacks the attribute.
    """
    user_settings = getattr(user, 'settings', None)
    return getattr(user_settings, 'language', None) or 'en'
