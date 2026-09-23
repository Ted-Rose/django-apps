from django.conf import settings
from django.db import models

from finance.managers import AccountQuerySet, TransactionQuerySet


class Requisition(models.Model):
    """GoCardless bank-account-data requisition (consent flow)."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='requisitions'
    )
    requisition_id = models.CharField(max_length=255, unique=True)
    institution_id = models.CharField(max_length=100)
    status = models.CharField(
        max_length=50,
        default='CR',
        help_text='GoCardless lifecycle status (CR, ID, LN, EX, RJ, ...)'
    )
    reference = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return (
            f'{self.institution_id} ({self.status}) '
            f'- {self.user.username}'
        )


class Account(models.Model):
    """Bank account linked via a requisition."""
    requisition = models.ForeignKey(
        Requisition,
        on_delete=models.CASCADE,
        related_name='accounts'
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='owned_accounts'
    )
    account_id = models.CharField(max_length=255, unique=True)
    iban = models.CharField(max_length=100, blank=True, null=True)
    institution_id = models.CharField(max_length=100)
    name = models.CharField(max_length=255, blank=True)
    currency = models.CharField(max_length=10, default='EUR')
    created_at = models.DateTimeField(auto_now_add=True)

    objects = AccountQuerySet.as_manager()

    def __str__(self):
        return self.name or self.iban or self.account_id


class AccountShare(models.Model):
    """Grants another user read access to an account."""
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='shares'
    )
    shared_with = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='shared_accounts'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('account', 'shared_with')

    def __str__(self):
        return f'{self.account} shared with {self.shared_with}'


class UserAccountPreference(models.Model):
    """Per-user preference for a (owned or shared) account."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='account_preferences'
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='user_preferences'
    )
    included_in_balance_check = models.BooleanField(default=True)

    class Meta:
        unique_together = ('user', 'account')

    def __str__(self):
        return f'{self.user.username} pref for {self.account}'


class Transaction(models.Model):
    """Booked bank transaction synced from GoCardless."""
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='transactions'
    )
    transaction_id = models.CharField(max_length=255)
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text='Outgoing payments are negative'
    )
    currency = models.CharField(max_length=10, default='EUR')
    booking_date = models.DateField()
    remittance_information = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects = TransactionQuerySet.as_manager()

    class Meta:
        unique_together = ('account', 'transaction_id')
        ordering = ['-booking_date']

    def __str__(self):
        return (
            f'{self.booking_date} {self.amount} {self.currency} '
            f'({self.account})'
        )


class TransactionLimit(models.Model):
    """Per user+account outgoing-spending limits (7/30 days)."""
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='limits'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    limit_7_days = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True
    )
    limit_30_days = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('account', 'user')

    def __str__(self):
        return f'Limits for {self.account} ({self.user.username})'
