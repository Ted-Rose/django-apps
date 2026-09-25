"""Per-user effective-category helpers.

Categorization is per-user via ``UserTransactionCategory``: every
per-user read of a transaction's category goes through these helpers
rather than touching ``category_assignments`` ad hoc.
"""
from django.db.models import OuterRef, Subquery

from finance.models import Category, UserTransactionCategory


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
    """
    return qs.annotate(
        effective_category_id=_user_category_subquery(
            user, 'category_id'
        )
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


def effective_category_for(transaction, user):
    """The user's assigned Category for the transaction, or None."""
    return Category.objects.filter(
        transaction_assignments__user=user,
        transaction_assignments__transaction=transaction,
    ).first()
