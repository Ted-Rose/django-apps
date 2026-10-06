from django.contrib import admin

from gmail.models import EmailParsingRule


@admin.register(EmailParsingRule)
class EmailParsingRuleAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'user', 'sender_pattern', 'priority', 'is_active',
        'force_language',
    ]
    list_filter = ['is_active', 'sender_match_type', 'force_language']
    search_fields = ['name', 'sender_pattern', 'user__username']
