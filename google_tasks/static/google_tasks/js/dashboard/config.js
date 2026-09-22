/**
 * Dashboard configuration bridge.
 *
 * Parses the JSON rendered in the template by
 * {{ dashboard_js_config|json_script:"dashboard-config" }} and exposes
 * it as window.DASHBOARD_CONFIG so static JS files can access values
 * that were previously produced by Django template tags ({% url %},
 * context flags, etc.).
 */
(function () {
    const configElement = document.getElementById('dashboard-config');
    window.DASHBOARD_CONFIG = configElement ?
        JSON.parse(configElement.textContent) : {};
})();

// Global flag consumed by create_task.js
const IS_STARRED_VIEW = !!(
    window.DASHBOARD_CONFIG.flags &&
    window.DASHBOARD_CONFIG.flags.is_starred_view
);
