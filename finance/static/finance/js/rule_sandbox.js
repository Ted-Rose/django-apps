/* Rule sandbox drawer: populates the rule form and live-previews
 * its impact via POST /finance/rules/preview/ (debounced). */
(function () {
    'use strict';

    var configEl = document.getElementById('sandbox-config');
    var form = document.getElementById('rule-form');
    if (!configEl || !form) {
        return;
    }
    var config = JSON.parse(configEl.textContent);
    var drawer = new bootstrap.Offcanvas(
        document.getElementById('rule-drawer')
    );
    var summaryEl = document.getElementById('preview-summary');
    var changesEl = document.getElementById('preview-changes');
    var csrfToken = form.querySelector(
        'input[name=csrfmiddlewaretoken]'
    ).value;
    var debounceTimer = null;

    function field(id) {
        return document.getElementById(id);
    }

    function payload() {
        var params = new URLSearchParams();
        params.set('rule_id', field('rule-id').value);
        params.set('category_id', field('rule-category').value);
        params.set('priority', field('rule-priority').value);
        params.set(
            'counterparty_scope',
            field('rule-counterparty-scope').value
        );
        params.set(
            'counterparty_pattern',
            field('rule-counterparty-pattern').value
        );
        params.set(
            'counterparty_match_type',
            field('rule-counterparty-match-type').value
        );
        params.set(
            'description_pattern',
            field('rule-description').value
        );
        params.set(
            'description_match_type',
            field('rule-description-match-type').value
        );
        params.set(
            'description_exclusion',
            field('rule-description-exclusion').value
        );
        params.set('operator', field('rule-operator').value);
        if (field('rule-is-active').checked) {
            params.set('is_active', 'on');
        }
        return params;
    }

    function cell(row, text, className) {
        var td = row.insertCell();
        td.textContent = text;
        if (className) {
            td.className = className;
        }
        return td;
    }

    function renderPreview(data) {
        changesEl.textContent = '';
        var changeText = '';
        if (data.changes_total) {
            var parts = [];
            if (data.gains) {
                parts.push(data.gains + ' gaining "' + data.category + '"');
            }
            if (data.losses) {
                parts.push(data.losses + ' losing it');
            }
            if (data.other_changes) {
                parts.push(data.other_changes + ' other');
            }
            changeText =
                ' ' + data.changes_total + ' would change category (' +
                parts.join(', ') + ').';
        } else {
            changeText = ' No categories would change.';
        }
        if (!data.is_active) {
            summaryEl.textContent =
                'Rule is inactive — it will not categorize anything ' +
                'until activated. ' + data.match_count +
                ' transaction(s) would match its patterns.' +
                changeText;
            return;
        }
        summaryEl.textContent =
            data.match_count + ' transaction(s) match, rule would ' +
            'apply to ' + data.apply_count + '.' + changeText;
        data.changes.forEach(function (change) {
            var row = changesEl.insertRow();
            cell(row, change.booking_date);
            cell(row, change.counterparty || '-');
            cell(row, change.description || '-');
            cell(
                row,
                change.amount + ' ' + change.currency,
                'text-end'
            );
            cell(
                row,
                (change.old_category || '—') + ' → ' +
                    (change.new_category || '—')
            );
        });
    }

    function requestPreview() {
        summaryEl.textContent = 'Calculating impact...';
        fetch(config.preview_url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': csrfToken,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: payload().toString(),
        })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (data.error) {
                    changesEl.textContent = '';
                    summaryEl.textContent = data.error;
                } else {
                    renderPreview(data);
                }
            })
            .catch(function () {
                summaryEl.textContent = 'Preview unavailable.';
            });
    }

    function schedulePreview() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(requestPreview, 300);
    }

    function maxPriority() {
        return config.rules.reduce(function (max, rule) {
            return Math.max(max, rule.priority);
        }, 0);
    }

    document
        .getElementById('new-rule-btn')
        .addEventListener('click', function () {
            form.reset();
            field('rule-id').value = '';
            field('rule-priority').value = maxPriority() + 1;
            field('rule-is-active').checked = true;
            document.getElementById('rule-drawer-title').textContent =
                'New rule';
            drawer.show();
            schedulePreview();
        });

    document
        .querySelectorAll('.edit-rule-btn')
        .forEach(function (button) {
            button.addEventListener('click', function () {
                var rule = config.rules.find(function (r) {
                    return r.id === Number(button.dataset.ruleId);
                });
                if (!rule) {
                    return;
                }
                field('rule-id').value = rule.id;
                field('rule-category').value = rule.category_id;
                field('rule-priority').value = rule.priority;
                field('rule-counterparty-scope').value =
                    rule.counterparty_scope;
                field('rule-counterparty-pattern').value =
                    rule.counterparty_pattern;
                field('rule-counterparty-match-type').value =
                    rule.counterparty_match_type;
                field('rule-description').value =
                    rule.description_pattern;
                field('rule-description-match-type').value =
                    rule.description_match_type;
                field('rule-description-exclusion').value =
                    rule.description_exclusion;
                field('rule-operator').value = rule.operator;
                field('rule-is-active').checked = rule.is_active;
                document.getElementById('rule-drawer-title')
                    .textContent = 'Edit rule #' + rule.priority;
                drawer.show();
                schedulePreview();
            });
        });

    form.addEventListener('input', schedulePreview);
    form.addEventListener('change', schedulePreview);
})();
