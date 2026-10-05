"""Per-user effective-category helpers.

Categorization is per-user via ``UserTransactionCategory``: every
per-user read of a transaction's category goes through these helpers
rather than touching ``category_assignments`` ad hoc.
"""
from decimal import Decimal

from django.db.models import (
    Case,
    DecimalField,
    F,
    OuterRef,
    Subquery,
    Value,
    When,
)
from django.db.models.functions import Abs, Coalesce, Least

from finance.models import Category, UserTransactionCategory

EXCLUDED_CATEGORY_NAME = 'Excluded'
EXCLUDED_CATEGORY_COLOR = '#6c757d'


def ensure_excluded_category(user):
    """Provision (or re-flag) the user's 'Excluded' category.

    Called for new users by the post_save receiver and safe to call
    for existing ones: a user-owned category already named
    'Excluded' is flagged rather than duplicated.
    """
    category, created = Category.objects.get_or_create(
        user=user,
        name=EXCLUDED_CATEGORY_NAME,
        defaults={
            'is_excluded': True,
            'color': EXCLUDED_CATEGORY_COLOR,
        },
    )
    if not created and not category.is_excluded:
        category.is_excluded = True
        category.save(update_fields=['is_excluded'])
    return category


def _user_category_subquery(user, field):
    return Subquery(
        UserTransactionCategory.objects.filter(
            user=user, transaction=OuterRef('pk')
        ).values(field)[:1]
    )


def annotate_effective_category(qs, user):
    """Annotate each transaction with the user's category id.

    ``effective_category_id`` is the category of the user's own
    ``UserTransactionCategory`` row, or None when uncategorized.
    ``category_is_manual`` marks that row as a manual override
    (NULL when the user has no row — read it as falsy).
    """
    return qs.annotate(
        effective_category_id=_user_category_subquery(
            user, 'category_id'
        ),
        category_is_manual=_user_category_subquery(user, 'is_manual'),
    )


def annotate_effective_category_name(qs, user):
    """Annotate each transaction with the user's category name.

    Adds ``effective_category_name`` — used for ORDER BY; for
    display, resolve ``effective_category_id`` against the user's
    categories instead.
    """
    return qs.annotate(
        effective_category_name=_user_category_subquery(
            user, 'category__name'
        )
    )


def annotate_counted_amount(qs, user):
    """Annotate the per-user counted amount of each transaction.

    The user's ``excluded_amount`` (NULL assignment → 0) reduces the
    raw amount toward zero without ever flipping its sign —
    ``counted = sign(amount) * max(0, |amount| - excluded)`` — so a
    −100 payment excluded by 50 counts −50, and excluding ≥ the
    amount counts 0. ``excluded_amount`` itself is annotated too so
    list rows can show how much was taken off.
    """
    clamp = Least(Abs('amount'), F('excluded_amount'))
    return qs.annotate(
        excluded_amount=Coalesce(
            _user_category_subquery(user, 'excluded_amount'),
            # '0.00' so the annotation serializes at the same 2dp
            # scale as the raw amount fields.
            Value(Decimal('0.00')),
            output_field=DecimalField(max_digits=12, decimal_places=2),
        ),
    ).annotate(
        counted_amount=Case(
            When(amount__lt=0, then=F('amount') + clamp),
            default=F('amount') - clamp,
            output_field=DecimalField(max_digits=12, decimal_places=2),
        )
    )


def effective_category_for(transaction, user):
    """The user's assigned Category for the transaction, or None."""
    return Category.objects.filter(
        transaction_assignments__user=user,
        transaction_assignments__transaction=transaction,
    ).first()
