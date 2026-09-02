from django.contrib import admin
from google_api.models import GoogleOAuthCredentials


@admin.register(GoogleOAuthCredentials)
class GoogleOAuthCredentialsAdmin(admin.ModelAdmin):
    list_display = ('user', 'token_expiry', 'created_at', 'updated_at')
    list_filter = ('created_at', 'updated_at')
    search_fields = ('user__username', 'user__email')
    readonly_fields = ('created_at', 'updated_at', 'scopes')
    
    def get_readonly_fields(self, request, obj=None):
        if obj:
            return self.readonly_fields + ('user',)
        return self.readonly_fields
