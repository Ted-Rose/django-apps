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


class Category(models.Model):
    """Per-user transaction category assigned by rules or manually."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='categories'
    )
    name = models.CharField(max_length=100)
    color = models.CharField(
        max_length=7,
        blank=True,
        default='',
        help_text='Optional hex color, e.g. #0d6efd'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'name')
        ordering = ['name']
        verbose_name_plural = 'categories'

    def __str__(self):
        return f'{self.name} ({self.user.username})'


class Transaction(models.Model):
    """Booked bank transaction synced from GoCardless."""
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='transactions'
    )
    transaction_id = models.CharField(max_length=255)
    internal_transaction_id = models.CharField(
        max_length=255, blank=True, null=True
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text='Outgoing payments are negative'
    )
    currency = models.CharField(max_length=10, default='EUR')
    booking_date = models.DateField()
    booking_date_time = models.DateTimeField(blank=True, null=True)
    remittance_information = models.TextField(blank=True, null=True)
    debtor_name = models.CharField(max_length=255, blank=True, null=True)
    debtor_account = models.JSONField(blank=True, null=True)
    creditor_name = models.CharField(
        max_length=255, blank=True, null=True
    )
    creditor_account = models.JSONField(blank=True, null=True)
    additional_information = models.TextField(blank=True, null=True)
    proprietary_bank_transaction_code = models.CharField(
        max_length=100, blank=True, null=True
    )
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


class UserTransactionCategory(models.Model):
    """One user's category assignment for a transaction.

    A transaction has at most one category per user; multiple users
    (owner + sharers) can each assign their own.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='transaction_categories'
    )
    transaction = models.ForeignKey(
        Transaction,
        on_delete=models.CASCADE,
        related_name='category_assignments'
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.CASCADE,
        related_name='transaction_assignments'
    )
    is_manual = models.BooleanField(
        default=False,
        help_text='Manual override; rules never change this row'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'transaction')

    def __str__(self):
        return (
            f'{self.user.username}: {self.category.name} '
            f'on {self.transaction}'
        )


class CategoryRule(models.Model):
    """Per-user rule that auto-assigns a category to transactions.

    Lower priority numbers are evaluated first; the first matching
    active rule wins.
    """
    MATCH_TYPES = [
        ('contains', 'Contains'),
        ('equals', 'Equals'),
        ('starts_with', 'Starts with'),
        ('ends_with', 'Ends with'),
    ]
    OPERATORS = [
        ('AND', 'AND'),
        ('OR', 'OR'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='category_rules'
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.CASCADE,
        related_name='rules'
    )
    priority = models.PositiveIntegerField(default=1)
    sender_receiver_pattern = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text='Matches debtor or creditor name'
    )
    description_pattern = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text='Matches remittance information'
    )
    match_type = models.CharField(
        max_length=20,
        choices=MATCH_TYPES,
        default='contains'
    )
    operator = models.CharField(
        max_length=3,
        choices=OPERATORS,
        default='AND',
        help_text='How the two patterns combine'
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['priority', 'pk']

    def __str__(self):
        return f'#{self.priority} -> {self.category.name}'


class TransactionLimit(models.Model):
    """Per user+account outgoing-spending limits (7/30 days).

    When ``category`` is set, only transactions in that category count
    towards the limit; when null, all outgoing spending counts.
    """
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='limits'
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.CASCADE,
        related_name='limits',
        null=True,
        blank=True,
        help_text='Optional: limit only spending in this category'
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
        unique_together = ('account', 'user', 'category')

    def __str__(self):
        scope = self.category.name if self.category else 'All'
        return (
            f'{scope} limits for {self.account} ({self.user.username})'
        )
