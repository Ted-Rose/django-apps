from django.urls import path

from finance import views

app_name = 'finance'

urlpatterns = [
    path('connect/', views.connect_bank, name='connect'),
    path('callback/', views.requisition_callback, name='callback'),
    path('accounts/', views.account_list, name='accounts'),
    path(
        'accounts/<int:account_id>/share/',
        views.share_account,
        name='share_account',
    ),
    path('transactions/', views.transaction_list, name='transactions'),
    path(
        'transactions/sync/',
        views.sync_transactions,
        name='sync_transactions',
    ),
    path('balances/', views.live_balances, name='balances'),
    path('limits/', views.limits_view, name='limits'),
]
