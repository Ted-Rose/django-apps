"""Seed the per-user 'Excluded' category for every existing user.

Transactions in an ``is_excluded`` category contribute nothing to
statistics (category-overview totals, the share chart, spending
limits). A user who already has a category literally named
'Excluded' gets it flagged instead of a duplicate — the flag, not
the name, drives the behavior.
"""
from django.conf import settings
from django.db import migrations


def seed_excluded_category(apps, schema_editor):
    User = apps.get_model(settings.AUTH_USER_MODEL)
    Category = apps.get_model('finance', 'Category')
    for user_id in User.objects.values_list('pk', flat=True):
        category = Category.objects.filter(
            user_id=user_id, name='Excluded'
        ).first()
        if category is None:
            Category.objects.create(
                user_id=user_id,
                name='Excluded',
                is_excluded=True,
                color='#6c757d',
            )
        elif not category.is_excluded:
            category.is_excluded = True
            category.save(update_fields=['is_excluded'])


class Migration(migrations.Migration):

    dependencies = [
        (
            'finance',
            '0016_category_is_excluded_categoryrule_excluded_amount_and_more',
        ),
    ]

    operations = [
        migrations.RunPython(
            seed_excluded_category, migrations.RunPython.noop
        ),
    ]
