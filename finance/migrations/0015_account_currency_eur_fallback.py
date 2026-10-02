from django.db import migrations


def set_eur_on_unknown_currency(apps, schema_editor):
    Account = apps.get_model('finance', 'Account')
    Account.objects.filter(
        currency__in=['XXX', '']
    ).update(currency='EUR')


class Migration(migrations.Migration):

    dependencies = [
        ('finance',
         '0014_alter_transactionlimit_unique_together_and_more'),
    ]

    operations = [
        migrations.RunPython(set_eur_on_unknown_currency),
    ]
