from django.conf import settings
from django.db import models


class EmailParsingRule(models.Model):
    """Per-user parsing/audio rule applied to fetched messages.

    The user's active rules are evaluated in (priority, pk) order;
    the first rule whose ``sender_pattern`` matches the From header
    applies — the same first-match-wins convention as
    ``finance.CategoryRule``. When no rule matches, the hardcoded
    e-klase special-case in services runs as the default path.
    """
    MATCH_TYPES = [
        ('contains', 'Contains'),
        ('equals', 'Equals'),
        ('starts_with', 'Starts with'),
        ('ends_with', 'Ends with'),
    ]
    LANGUAGE_CHOICES = [
        ('lv', 'Latvian'),
        ('en', 'English'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='email_parsing_rules',
    )
    name = models.CharField(max_length=100)
    priority = models.PositiveIntegerField(default=100)
    is_active = models.BooleanField(default=True)

    sender_pattern = models.CharField(
        max_length=255,
        help_text=(
            'Matched against the raw From header '
            '(e.g. "e-klase <notifikacijas@e-klase.lv>"), '
            'case-insensitive'
        ),
    )
    sender_match_type = models.CharField(
        max_length=20,
        choices=MATCH_TYPES,
        default='contains',
    )

    force_language = models.CharField(
        max_length=2,
        choices=LANGUAGE_CHOICES,
        blank=True,
        default='',
        help_text=(
            'Pin the audio language instead of auto-detecting it; '
            'returned as the message "lang" hint'
        ),
    )

    # Extraction — applied in order, all optional. Capture-group 1
    # (or the whole match when there is no group) is the extracted
    # text; both search the parsed body with re.DOTALL.
    subject_regex = models.TextField(
        blank=True,
        default='',
        help_text=(
            'First capture group replaces the subject '
            '(e.g. "Tēma: (.*?)(?=No:)")'
        ),
    )
    body_regex = models.TextField(
        blank=True,
        default='',
        help_text='First capture group replaces the parsed body',
    )
    strip_patterns = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            'List of regexes removed from the extracted body via '
            're.sub with re.DOTALL (headers, footers, attachment '
            'lines); whitespace is collapsed afterwards'
        ),
    )

    # What the audio reads — model only, no SPA wiring yet.
    include_subject = models.BooleanField(default=True)
    include_sender = models.BooleanField(default=True)

    # Future: share rules between users (deferred, unused for now).
    is_shared = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['priority', 'pk']

    def __str__(self):
        return f'{self.name} ({self.user.username})'
