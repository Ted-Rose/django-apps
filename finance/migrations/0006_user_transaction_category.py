import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models import F


def backfill_category_assignments(apps, schema_editor):
    """Copy Transaction.category into per-owner assignment rows."""
    Transaction = apps.get_model('finance', 'Transaction')
    UserTransactionCategory = apps.get_model(
        'finance', 'UserTransactionCategory'
    )
    rows = (
        Transaction.objects
        .filter(category__isnull=False)
        .values(
            'pk',
            'account__owner_id',
            'category_id',
            'is_manual_category',
        )
        .iterator()
    )
    batch = []
    for row in rows:
        batch.append(UserTransactionCategory(
            user_id=row['account__owner_id'],
            transaction_id=row['pk'],
            category_id=row['category_id'],
            is_manual=row['is_manual_category'],
        ))
        if len(batch) >= 500:
            UserTransactionCategory.objects.bulk_create(batch)
            batch = []
    if batch:
        UserTransactionCategory.objects.bulk_create(batch)


def restore_category_columns(apps, schema_editor):
    """Best-effort reverse: copy owner assignment rows back."""
    Transaction = apps.get_model('finance', 'Transaction')
    UserTransactionCategory = apps.get_model(
        'finance', 'UserTransactionCategory'
    )
    for row in UserTransactionCategory.objects.filter(
        user_id=F('transaction__account__owner_id')
    ).iterator():
        Transaction.objects.filter(pk=row.transaction_id).update(
            category_id=row.category_id,
            is_manual_category=row.is_manual,
        )


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('finance', '0005_alter_transactionlimit_unique_together_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserTransactionCategory',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True, primary_key=True,
                    serialize=False, verbose_name='ID',
                )),
                ('is_manual', models.BooleanField(
                    default=False,
                    help_text='Manual override; rules never change this row',
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('category', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='transaction_assignments',
                    to='finance.category',
                )),
                ('transaction', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='category_assignments',
                    to='finance.transaction',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='transaction_categories',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'unique_together': {('user', 'transaction')},
            },
        ),
        migrations.RunPython(
            backfill_category_assignments,
            restore_category_columns,
        ),
        migrations.RemoveField(
            model_name='transaction',
            name='category',
        ),
        migrations.RemoveField(
            model_name='transaction',
            name='is_manual_category',
        ),
    ]
