"""Rule-based transaction categorization.

Each user's active CategoryRules are evaluated in (priority, pk)
order; the first matching rule assigns its category. Categorization
is per-user: rules write ``UserTransactionCategory`` rows keyed by
(user, transaction), and rows flagged ``is_manual`` are never
touched by rules.

Rules apply to every transaction the user can see — owned and
shared accounts alike.
"""
import logging
from types import SimpleNamespace

from finance.models import (
    Category,
    CategoryRule,
    Transaction,
    UserTransactionCategory,
)

logger = logging.getLogger('django')

MAX_PREVIEW_CHANGES = 50
_VALID_MATCH_TYPES = {code for code, _ in CategoryRule.MATCH_TYPES}
_VALID_OPERATORS = {code for code, _ in CategoryRule.OPERATORS}


def _matches_value(value, pattern, match_type):
    """Case-insensitive match of pattern against a raw field value."""
    value = (value or '').casefold()
    pattern = pattern.casefold()
    if match_type == 'equals':
        return value == pattern
    if match_type == 'starts_with':
        return value.startswith(pattern)
    if match_type == 'ends_with':
        return value.endswith(pattern)
    return pattern in value


def rule_matches(rule, transaction):
    """True when the rule's patterns match the transaction.

    A blank pattern contributes no check; a rule with both patterns
    blank never matches.
    """
    checks = []
    if rule.sender_receiver_pattern:
        checks.append(
            _matches_value(
                transaction.debtor_name,
                rule.sender_receiver_pattern,
                rule.match_type,
            )
            or _matches_value(
                transaction.creditor_name,
                rule.sender_receiver_pattern,
                rule.match_type,
            )
        )
    if rule.description_pattern:
        checks.append(
            _matches_value(
                transaction.remittance_information,
                rule.description_pattern,
                rule.match_type,
            )
        )
    if not checks:
        return False
    if rule.operator == 'OR':
        return any(checks)
    return all(checks)


def first_matching_rule(rules, transaction):
    """Return the first rule (priority order) matching the tx."""
    for rule in rules:
        if rule_matches(rule, transaction):
            return rule
    return None


def active_rules_for(user):
    """The user's active rules, ordered for first-match evaluation."""
    return list(
        CategoryRule.objects.filter(user=user, is_active=True)
        .select_related('category')
        .order_by('priority', 'pk')
    )


def categorizable_transactions(user):
    """Transactions the user's rules may categorize (owned+shared)."""
    return Transaction.objects.for_user(user).select_related('account')


_UNSET = object()


def categorize_transaction(transaction, rules, user, assignment=_UNSET):
    """Assign ``user``'s category for the tx by first matching rule.

    Creates, updates or deletes the user's
    ``UserTransactionCategory`` row; rows flagged ``is_manual`` are
    never touched. ``assignment`` may carry the already-fetched row
    to skip the lookup. Returns True when the assignment changed.
    """
    if assignment is _UNSET:
        assignment = UserTransactionCategory.objects.filter(
            user=user, transaction=transaction,
        ).first()
    if assignment is not None and assignment.is_manual:
        return False
    rule = first_matching_rule(rules, transaction)
    if rule is None:
        if assignment is None:
            return False
        assignment.delete()
        return True
    if (
        assignment is not None
        and assignment.category_id == rule.category_id
    ):
        return False
    if assignment is None:
        UserTransactionCategory.objects.create(
            user=user,
            transaction=transaction,
            category=rule.category,
        )
    else:
        assignment.category = rule.category
        assignment.save(update_fields=['category', 'updated_at'])
    return True


def apply_rules(user):
    """Re-run the user's rules over all accessible history.

    Returns the number of transactions whose assignment changed.
    """
    rules = active_rules_for(user)
    transactions = categorizable_transactions(user)
    assignments = {
        row.transaction_id: row
        for row in UserTransactionCategory.objects.filter(
            user=user, transaction__in=transactions,
        )
    }
    changed = 0
    for transaction in transactions.iterator():
        if categorize_transaction(
            transaction, rules, user, assignments.get(transaction.pk)
        ):
            changed += 1
    return changed


def _to_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def preview_rule(user, data):
    """Simulate a candidate rule against the user's history.

    Read-only: compares the simulated first-match outcome against
    the user's own category assignments. ``data`` is a dict with the
    form fields (``category_id``, ``priority``, the two patterns,
    ``match_type``, ``operator``, ``is_active``) plus optional
    ``rule_id`` when editing an existing rule.

    Returns ``{'error': msg}`` on invalid input.
    """
    category = Category.objects.filter(
        user=user, pk=_to_int(data.get('category_id'), 0)
    ).first()
    if category is None:
        return {'error': 'Pick a category to preview.'}

    rule_id = _to_int(data.get('rule_id'), 0) or None
    match_type = data.get('match_type')
    if match_type not in _VALID_MATCH_TYPES:
        match_type = 'contains'
    operator = data.get('operator')
    if operator not in _VALID_OPERATORS:
        operator = 'AND'

    candidate = SimpleNamespace(
        # Unsaved rules sort after equal priorities, like a fresh pk.
        pk=rule_id or 2 ** 62,
        priority=max(_to_int(data.get('priority'), 1), 1),
        sender_receiver_pattern=(
            data.get('sender_receiver_pattern') or ''
        ),
        description_pattern=data.get('description_pattern') or '',
        match_type=match_type,
        operator=operator,
        is_active=data.get('is_active') in ('on', 'true', '1', True),
        category=category,
        category_id=category.pk,
    )

    rules = [
        rule for rule in active_rules_for(user)
        if rule.pk != rule_id
    ]
    if candidate.is_active:
        rules.append(candidate)
    rules.sort(key=lambda rule: (rule.priority, rule.pk))

    transactions = categorizable_transactions(user)
    assignments = {
        row.transaction_id: row
        for row in UserTransactionCategory.objects.filter(
            user=user, transaction__in=transactions,
        ).select_related('category')
    }

    match_count = 0
    apply_count = 0
    changes = []
    changes_total = 0
    for tx in transactions.iterator():
        assignment = assignments.get(tx.pk)
        if assignment is not None and assignment.is_manual:
            continue
        if rule_matches(candidate, tx):
            match_count += 1
        first = first_matching_rule(rules, tx)
        if first is candidate:
            apply_count += 1
        new_category = first.category if first else None
        new_id = new_category.pk if new_category else None
        old_id = assignment.category_id if assignment else None
        if new_id == old_id:
            continue
        changes_total += 1
        if len(changes) < MAX_PREVIEW_CHANGES:
            changes.append({
                'id': tx.pk,
                'booking_date': tx.booking_date.isoformat(),
                'account': str(tx.account),
                'counterparty': (
                    tx.creditor_name or tx.debtor_name or ''
                ),
                'description': tx.remittance_information or '',
                'amount': str(tx.amount),
                'currency': tx.currency,
                'old_category': (
                    assignment.category.name if assignment else None
                ),
                'new_category': (
                    new_category.name if new_category else None
                ),
            })

    return {
        'success': True,
        'match_count': match_count,
        'apply_count': apply_count,
        'is_active': candidate.is_active,
        'changes_total': changes_total,
        'changes': changes,
    }
