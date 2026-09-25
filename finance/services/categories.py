"""Per-user effective-category helpers.

Categorization is per-user via ``UserTransactionCategory``: every
per-user read of a transaction's category goes through these helpers
rather than touching ``category_assignments`` ad hoc.
"""
from django.db.models import OuterRef, Subquery

from finance.models import Category, UserTransactionCategory


def annotate_effective_category(qs, user):
    """Annotate each transaction with the user's category id.

    ``effective_category_id`` is the category of the user's own
    ``UserTransactionCategory`` row, or None when uncategorized.
    """
    return qs.annotate(
        effective_category_id=Subquery(
            UserTransactionCategory.objects.filter(
                user=user, transaction=OuterRef('pk')
            ).values('category_id')[:1]
        )
    )


def effective_category_for(transaction, user):
    """The user's assigned Category for the transaction, or None."""
    return Category.objects.filter(
        transaction_assignments__user=user,
        transaction_assignments__transaction=transaction,
    ).first()
