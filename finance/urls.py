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
    path(
        'push/subscribe/',
        views.push_subscribe,
        name='push_subscribe',
    ),
    path(
        'push/unsubscribe/',
        views.push_unsubscribe,
        name='push_unsubscribe',
    ),
    path('rules/', views.rules_view, name='rules'),
    path('rules/save/', views.save_rule, name='save_rule'),
    path(
        'rules/<int:rule_id>/delete/',
        views.delete_rule,
        name='delete_rule',
    ),
    path(
        'rules/<int:rule_id>/move/',
        views.move_rule,
        name='move_rule',
    ),
    path('rules/apply/', views.apply_rules_view, name='apply_rules'),
    path(
        'rules/preview/',
        views.preview_rule_view,
        name='preview_rule',
    ),
    path(
        'categories/',
        views.category_overview,
        name='categories',
    ),
    path(
        'categories/save/',
        views.save_category,
        name='save_category',
    ),
    path(
        'categories/<int:category_id>/delete/',
        views.delete_category,
        name='delete_category',
    ),
]
