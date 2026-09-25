/* Spending-limit push alerts: subscribe/unsubscribe this browser
 * via POST /finance/push/subscribe|unsubscribe/. */
(function () {
    'use strict';

    var configEl = document.getElementById('push-config');
    var enableBtn = document.getElementById('push-enable-btn');
    var disableBtn = document.getElementById('push-disable-btn');
    var statusEl = document.getElementById('push-status');
    if (!configEl || !enableBtn || !disableBtn) {
        return;
    }
    var config = JSON.parse(configEl.textContent);
    var csrfInput = document.querySelector(
        'input[name=csrfmiddlewaretoken]'
    );
    var csrfToken = csrfInput ? csrfInput.value : '';
    if (!csrfToken) {
        var match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
        csrfToken = match ? match[1] : '';
    }
    var supported = (
        'serviceWorker' in navigator &&
        'PushManager' in window &&
        'Notification' in window
    );

    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - base64String.length % 4) % 4);
        var base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        var rawData = window.atob(base64);
        var outputArray = new Uint8Array(rawData.length);
        for (var i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    function post(url, payload) {
        return fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': csrfToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        }).then(function (response) {
            return response.json().then(function (data) {
                if (!response.ok) {
                    throw new Error(data.error || 'Request failed');
                }
                return data;
            });
        });
    }

    function sameKey(subscription) {
        // True when the browser subscription was created with the
        // currently configured VAPID public key.
        var key = subscription.options &&
            subscription.options.applicationServerKey;
        if (!key) {
            return true; // cannot tell — assume it is ours
        }
        var expected = urlBase64ToUint8Array(config.vapid_public_key);
        var actual = new Uint8Array(key);
        if (actual.length !== expected.length) {
            return false;
        }
        for (var i = 0; i < expected.length; ++i) {
            if (actual[i] !== expected[i]) {
                return false;
            }
        }
        return true;
    }

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function renderState(subscribed) {
        enableBtn.classList.toggle('d-none', subscribed);
        disableBtn.classList.toggle('d-none', !subscribed);
        setStatus(
            subscribed ? '— this browser is subscribed' : ''
        );
    }

    function refreshState() {
        if (!supported) {
            enableBtn.disabled = true;
            setStatus('— push notifications are not supported here');
            return;
        }
        navigator.serviceWorker.ready
            .then(function (registration) {
                return registration.pushManager.getSubscription();
            })
            .then(function (subscription) {
                if (subscription && !sameKey(subscription)) {
                    // Bound to a different VAPID key — pushes can
                    // never succeed, so drop the stale subscription.
                    return subscription.unsubscribe().then(
                        function () { return null; }
                    );
                }
                if (subscription) {
                    // Browser stayed subscribed but the server row
                    // may be gone — re-register (best effort).
                    post(
                        config.subscribe_url, subscription.toJSON()
                    ).catch(function () {});
                }
                return subscription;
            })
            .then(function (subscription) {
                renderState(!!subscription);
            })
            .catch(function () {
                renderState(false);
            });
    }

    enableBtn.addEventListener('click', function () {
        enableBtn.disabled = true;
        Notification.requestPermission()
            .then(function (permission) {
                if (permission !== 'granted') {
                    throw new Error(
                        'Notification permission not granted'
                    );
                }
                return navigator.serviceWorker.ready;
            })
            .then(function (registration) {
                // Replace any existing subscription so it is bound
                // to the current VAPID key.
                return registration.pushManager.getSubscription()
                    .then(function (existing) {
                        if (existing) {
                            return existing.unsubscribe();
                        }
                    })
                    .then(function () {
                        return registration.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: urlBase64ToUint8Array(
                                config.vapid_public_key
                            ),
                        });
                    });
            })
            .then(function (subscription) {
                return post(
                    config.subscribe_url, subscription.toJSON()
                );
            })
            .then(function () {
                renderState(true);
                window.location.reload();
            })
            .catch(function (err) {
                setStatus('— ' + (err.message || 'Subscribe failed'));
            })
            .finally(function () {
                enableBtn.disabled = false;
            });
    });

    disableBtn.addEventListener('click', function () {
        disableBtn.disabled = true;
        navigator.serviceWorker.ready
            .then(function (registration) {
                return registration.pushManager.getSubscription();
            })
            .then(function (subscription) {
                if (!subscription) {
                    return null;
                }
                return post(config.unsubscribe_url, {
                    endpoint: subscription.endpoint,
                }).catch(function () {
                    // Server row may already be gone; the local
                    // unsubscribe still has to happen.
                }).then(function () {
                    return subscription.unsubscribe();
                });
            })
            .then(function () {
                renderState(false);
                window.location.reload();
            })
            .catch(function (err) {
                setStatus(
                    '— ' + (err.message || 'Unsubscribe failed')
                );
            })
            .finally(function () {
                disableBtn.disabled = false;
            });
    });

    refreshState();
})();
