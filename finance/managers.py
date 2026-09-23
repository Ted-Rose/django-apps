from django.db import models
from django.db.models import Q


class AccountQuerySet(models.QuerySet):
    def for_user(self, user):
        return self.filter(
            Q(owner=user) | Q(shares__shared_with=user)
        ).distinct()


class TransactionQuerySet(models.QuerySet):
    def for_user(self, user):
        from finance.models import Account
        return self.filter(
            account__in=Account.objects.for_user(user)
        ).distinct()
