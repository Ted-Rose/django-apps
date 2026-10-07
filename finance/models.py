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
    last_balance = models.JSONField(
        blank=True,
        null=True,
        help_text='Last balance object fetched from GoCardless'
    )
    balance_updated_at = models.DateTimeField(
        blank=True,
        null=True,
        help_text='When last_balance was fetched'
    )
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


class CategoryOverviewShare(models.Model):
    """Read access to (part of) the sharer's category overview.

    ``accounts`` empty = the sharer's whole overview (every
    account ``for_user(sharer)`` covers). Non-empty = only those
    accounts — which may be owned or merely shared with the
    sharer.
    """
    sharer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='overview_shares',
    )
    shared_with = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='shared_overviews',
    )
    accounts = models.ManyToManyField(
        Account,
        blank=True,
        related_name='overview_shares',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('sharer', 'shared_with')

    def __str__(self):
        return f'{self.sharer} overview shared with {self.shared_with}'


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
    is_excluded = models.BooleanField(
        default=False,
        help_text=(
            'Transactions in this category are excluded from '
            'statistics (totals, chart, limits)'
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'name')
        ordering = ['name']
        verbose_name_plural = 'categories'

    def __str__(self):
        return f'{self.name} ({self.user.username})'


class Transaction(models.Model):
    """Bank transaction synced from GoCardless."""
    STATUS_BOOKED = 'booked'
    STATUS_PENDING = 'pending'

    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='transactions'
    )
    transaction_id = models.CharField(max_length=255)
    internal_transaction_id = models.CharField(
        max_length=255, blank=True, null=True
    )
    status = models.CharField(
        max_length=20,
        default=STATUS_BOOKED,
        help_text=(
            'Transactions-list group the entry came from: booked, '
            'pending, or any other group the API returns (Berlin '
            'Group spec also allows info). Non-booked rows are '
            'transient — replaced by the booked transaction once '
            'it settles'
        ),
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text='Outgoing payments are negative'
    )
    currency = models.CharField(max_length=10, default='EUR')
    booking_date = models.DateField()
    booking_date_time = models.DateTimeField(blank=True, null=True)
    value_date = models.DateField(blank=True, null=True)
    value_date_time = models.DateTimeField(blank=True, null=True)
    end_to_end_id = models.CharField(
        max_length=255, blank=True, null=True
    )
    bank_transaction_code = models.CharField(
        max_length=100, blank=True, null=True,
        help_text='ISO 20022 code, e.g. PMNT-CCRD-POSD'
    )
    remittance_information = models.TextField(blank=True, null=True)
    remittance_information_array = models.JSONField(
        blank=True,
        null=True,
        help_text='Raw remittanceInformationUnstructuredArray'
    )
    debtor_name = models.CharField(max_length=255, blank=True, null=True)
    debtor_account = models.JSONField(blank=True, null=True)
    creditor_name = models.CharField(
        max_length=255, blank=True, null=True
    )
    creditor_account = models.JSONField(blank=True, null=True)
    additional_information = models.TextField(blank=True, null=True)
    additional_data_structured = models.JSONField(
        blank=True,
        null=True,
        help_text='Raw additionalDataStructured (e.g. card instrument)'
    )
    proprietary_bank_transaction_code = models.CharField(
        max_length=100, blank=True, null=True
    )
    balance_after_transaction = models.JSONField(
        blank=True,
        null=True,
        help_text='Raw balanceAfterTransaction object'
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
        related_name='transaction_assignments',
        null=True,
        blank=True,
        help_text=(
            'NULL only on manual rows that lock the transaction '
            'as uncategorized'
        ),
    )
    is_manual = models.BooleanField(
        default=False,
        help_text='Manual override; rules never change this row'
    )
    excluded_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        help_text='Part of the amount this user does not count',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'transaction')

    def __str__(self):
        category = self.category.name if self.category else 'None'
        return (
            f'{self.user.username}: {category} '
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
    COUNTERPARTY_SCOPES = [
        ('any', 'Debtor or creditor'),
        ('debtor', 'Debtor (sender)'),
        ('creditor', 'Creditor (receiver)'),
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
    counterparty_scope = models.CharField(
        max_length=10,
        choices=COUNTERPARTY_SCOPES,
        default='any',
        help_text='Which name field the counterparty pattern matches'
    )
    counterparty_pattern = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text='Matches the scoped debtor/creditor name'
    )
    counterparty_match_type = models.CharField(
        max_length=20,
        choices=MATCH_TYPES,
        default='contains'
    )
    description_pattern = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text='Matches remittance information'
    )
    description_match_type = models.CharField(
        max_length=20,
        choices=MATCH_TYPES,
        default='contains'
    )
    description_exclusion = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text='Rule never applies when remittance info contains this'
    )
    operator = models.CharField(
        max_length=3,
        choices=OPERATORS,
        default='AND',
        help_text='How the counterparty and description patterns combine'
    )
    is_active = models.BooleanField(default=True)
    excluded_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            'When set, this much of each matched transaction is '
            'excluded from statistics'
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['priority', 'pk']

    def __str__(self):
        return f'#{self.priority} -> {self.category.name}'


class TransactionLimit(models.Model):
    """Per user outgoing-spending limits over a set of accounts.

    Three window kinds: rolling 7 days, rolling 30 days, or the
    current calendar month. When ``category`` is set, only
    transactions in that category count towards the limit; when
    null, all outgoing spending counts. A user's limits with the
    same category must cover disjoint account sets — enforced in
    the API since unique constraints can't span a M2M.
    """
    accounts = models.ManyToManyField(
        Account,
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
    limit_monthly = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text='Limit for the current calendar month'
    )
    is_active = models.BooleanField(default=True)
    alerted_7d_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When a push alert was last sent for the 7-day window'
    )
    alerted_30d_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When a push alert was last sent for the 30-day window'
    )
    alerted_monthly_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When a push alert was last sent for the monthly window'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        scope = self.category.name if self.category else 'All'
        accounts = ', '.join(str(a) for a in self.accounts.all())
        return (
            f'{scope} limits for {accounts} ({self.user.username})'
        )


class LimitEvaluation(models.Model):
    """Recorded monthly evaluation of a TransactionLimit.

    One row per (limit, calendar month): ``evaluate_spending_limits``
    refreshes it on every run, so the last run inside a month holds
    that month's final recorded figures — including the threshold at
    the time, which the limits page uses for past-month history.
    """
    limit = models.ForeignKey(
        TransactionLimit,
        on_delete=models.CASCADE,
        related_name='evaluations'
    )
    period_start = models.DateField(
        help_text='First day of the evaluated calendar month'
    )
    spent = models.DecimalField(max_digits=12, decimal_places=2)
    threshold = models.DecimalField(max_digits=12, decimal_places=2)
    evaluated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('limit', 'period_start')
        ordering = ['-period_start']

    @property
    def exceeded(self):
        return self.spent > self.threshold

    def __str__(self):
        return f'{self.limit} — {self.period_start:%b %Y}'


class BalanceAlert(models.Model):
    """Per user+account low-balance push alert.

    Re-fires while the breach persists: ``alerted_at`` is stamped
    each time the notification goes out, and the alert repeats once
    it is older than ``ALERT_REPEAT_AFTER`` (services/push.py). The
    flag is cleared once the balance is back at or above
    ``threshold``, so a later drop alerts again immediately.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='balance_alerts',
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='balance_alerts',
    )
    threshold = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text=(
            'Alert when the account balance drops below this amount '
            '(in the account currency; may be negative)'
        ),
    )
    is_active = models.BooleanField(default=True)
    alerted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When the low-balance push was last sent',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'account')

    def __str__(self):
        return (
            f'{self.user.username}: {self.account} '
            f'below {self.threshold} {self.account.currency}'
        )


class Notification(models.Model):
    """In-app alert surfaced to the user on their next SPA visit."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='finance_notifications',
    )
    title = models.CharField(max_length=200)
    body = models.TextField()
    url = models.CharField(
        max_length=500,
        help_text='SPA path the notification opens, e.g. /finance/balances/'
    )
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user.username}: {self.title}'


class PushSubscription(models.Model):
    """A Web Push subscription for one of the user's browsers."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='push_subscriptions'
    )
    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.user.username}: {self.endpoint[:60]}'
