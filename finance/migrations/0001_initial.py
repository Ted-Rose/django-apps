from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Account',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID',
                )),
                ('account_id', models.CharField(
                    max_length=255, unique=True)),
                ('iban', models.CharField(
                    blank=True, max_length=100, null=True)),
                ('institution_id', models.CharField(max_length=100)),
                ('name', models.CharField(blank=True, max_length=255)),
                ('currency', models.CharField(
                    default='EUR', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('owner', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='owned_accounts',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
        ),
        migrations.CreateModel(
            name='Requisition',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID',
                )),
                ('requisition_id', models.CharField(
                    max_length=255, unique=True)),
                ('institution_id', models.CharField(max_length=100)),
                ('status', models.CharField(
                    default='CR',
                    help_text=(
                        'GoCardless lifecycle status '
                        '(CR, ID, LN, EX, RJ, ...)'
                    ),
                    max_length=50,
                )),
                ('reference', models.CharField(
                    max_length=255, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='requisitions',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
        ),
        migrations.AddField(
            model_name='account',
            name='requisition',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name='accounts',
                to='finance.requisition',
            ),
        ),
        migrations.CreateModel(
            name='AccountShare',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID',
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('account', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='shares',
                    to='finance.account',
                )),
                ('shared_with', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='shared_accounts',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'unique_together': {('account', 'shared_with')},
            },
        ),
        migrations.CreateModel(
            name='TransactionLimit',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID',
                )),
                ('limit_7_days', models.DecimalField(
                    blank=True,
                    decimal_places=2,
                    max_digits=12,
                    null=True,
                )),
                ('limit_30_days', models.DecimalField(
                    blank=True,
                    decimal_places=2,
                    max_digits=12,
                    null=True,
                )),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('account', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='limits',
                    to='finance.account',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'unique_together': {('account', 'user')},
            },
        ),
        migrations.CreateModel(
            name='Transaction',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID',
                )),
                ('transaction_id', models.CharField(max_length=255)),
                ('amount', models.DecimalField(
                    decimal_places=2,
                    help_text='Outgoing payments are negative',
                    max_digits=12,
                )),
                ('currency', models.CharField(
                    default='EUR', max_length=10)),
                ('booking_date', models.DateField()),
                ('remittance_information', models.TextField(
                    blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('account', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='transactions',
                    to='finance.account',
                )),
            ],
            options={
                'ordering': ['-booking_date'],
                'unique_together': {('account', 'transaction_id')},
            },
        ),
        migrations.CreateModel(
            name='UserAccountPreference',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID',
                )),
                ('included_in_balance_check', models.BooleanField(
                    default=True)),
                ('account', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='user_preferences',
                    to='finance.account',
                )),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='account_preferences',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'unique_together': {('user', 'account')},
            },
        ),
    ]
