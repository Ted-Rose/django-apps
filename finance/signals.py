from django.contrib.auth import get_user_model
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from finance.models import AccountShare, UserTransactionCategory
from finance.services.categories import ensure_excluded_category


@receiver(post_save, sender=get_user_model())
def provision_excluded_category(sender, instance, created, **kwargs):
    """Every new user gets the flagged 'Excluded' category."""
    if created:
        ensure_excluded_category(instance)


@receiver(post_delete, sender=AccountShare)
def delete_shared_user_categories(sender, instance, **kwargs):
    """Drop the ex-viewer's category rows on the shared account."""
    UserTransactionCategory.objects.filter(
        user=instance.shared_with,
        transaction__account=instance.account,
    ).delete()
