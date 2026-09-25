from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='transaction',
            name='internal_transaction_id',
            field=models.CharField(
                blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='transaction',
            name='booking_date_time',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='transaction',
            name='debtor_name',
            field=models.CharField(
                blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='transaction',
            name='debtor_account',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='transaction',
            name='creditor_name',
            field=models.CharField(
                blank=True, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name='transaction',
            name='creditor_account',
            field=models.JSONField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='transaction',
            name='additional_information',
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='transaction',
            name='proprietary_bank_transaction_code',
            field=models.CharField(
                blank=True, max_length=100, null=True),
        ),
    ]
