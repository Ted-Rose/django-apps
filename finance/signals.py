from django.db.models.signals import post_delete
from django.dispatch import receiver

from finance.models import AccountShare, UserTransactionCategory


@receiver(post_delete, sender=AccountShare)
def delete_shared_user_categories(sender, instance, **kwargs):
    """Drop the ex-viewer's category rows on the shared account."""
    UserTransactionCategory.objects.filter(
        user=instance.shared_with,
        transaction__account=instance.account,
    ).delete()
