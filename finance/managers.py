from django.db import models
from django.db.models import Case, DateField, F, Q, When


class AccountQuerySet(models.QuerySet):
    def for_user(self, user):
        return self.filter(
            Q(owner=user) | Q(shares__shared_with=user)
        ).distinct()

    def visible_for(self, user):
        """``for_user`` minus accounts the user excluded.

        The set every page except Accounts reads — an excluded
        account surfaces only on the Accounts page until the user
        includes it again. The ``pk__in`` subquery matters:
        ``exclude(rel__a=x, rel__b=y)`` splits multi-valued
        relations into one EXISTS per condition, so another
        user's excluded pref would hide the account from this
        user too — exclusion must stay per-user.
        """
        accessible = self.for_user(user)
        return accessible.exclude(
            pk__in=accessible.filter(
                user_preferences__user=user,
                user_preferences__excluded=True,
            )
        )


class TransactionQuerySet(models.QuerySet):
    def for_user(self, user):
        from finance.models import Account
        return self.filter(
            account__in=Account.objects.for_user(user)
        ).distinct()

    def visible_for(self, user):
        """Transactions on ``visible_for`` accounts — excluded
        accounts' transactions reach no page or aggregation."""
        from finance.models import Account
        return self.filter(
            account__in=Account.objects.visible_for(user)
        ).distinct()

    def with_occurrence_date(self):
        """Annotate ``occurrence_date``: when the money moved for
        the user — the earlier of ``booking_date``/``value_date``.

        Banks disagree on which field carries the event date:
        Swedbank books card purchases on the posting date and puts
        the purchase date in ``valueDate``; other banks reverse
        it. The event always precedes posting/settlement, so the
        earlier non-null date is the day the user spent or
        received the money.
        """
        return self.annotate(
            occurrence_date=Case(
                When(
                    value_date__lt=F('booking_date'),
                    then=F('value_date'),
                ),
                default=F('booking_date'),
                output_field=DateField(),
            )
        )
