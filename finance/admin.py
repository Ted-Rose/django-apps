from django.contrib import admin

from finance.models import (
    Account,
    AccountShare,
    Requisition,
    Transaction,
    TransactionLimit,
    UserAccountPreference,
)


@admin.register(Requisition)
class RequisitionAdmin(admin.ModelAdmin):
    list_display = [
        'user', 'institution_id', 'status', 'requisition_id',
        'created_at', 'updated_at',
    ]
    list_filter = ['status', 'institution_id']
    search_fields = ['requisition_id', 'reference', 'user__username']


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'iban', 'owner', 'institution_id', 'currency',
        'created_at',
    ]
    list_filter = ['institution_id', 'currency', 'owner']
    search_fields = ['name', 'iban', 'account_id', 'owner__username']


@admin.register(AccountShare)
class AccountShareAdmin(admin.ModelAdmin):
    list_display = ['account', 'shared_with', 'created_at']
    search_fields = ['account__name', 'shared_with__username']


@admin.register(UserAccountPreference)
class UserAccountPreferenceAdmin(admin.ModelAdmin):
    list_display = ['user', 'account', 'included_in_balance_check']
    list_filter = ['included_in_balance_check', 'user']


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = [
        'account', 'booking_date', 'amount', 'currency',
        'transaction_id',
    ]
    list_filter = ['account', 'currency', 'booking_date']
    search_fields = ['transaction_id', 'remittance_information']
    date_hierarchy = 'booking_date'


@admin.register(TransactionLimit)
class TransactionLimitAdmin(admin.ModelAdmin):
    list_display = [
        'user', 'account', 'limit_7_days', 'limit_30_days',
        'is_active', 'updated_at',
    ]
    list_filter = ['is_active', 'user']
