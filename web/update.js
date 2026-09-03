/* MedyaAtlas web update — alt banner + SW SKIP_WAITING + tek reload.
 * Placeholders: __MEDYAATLAS_VERSION__
 */
(function () {
  'use strict';

  var APP_VERSION =
    (window.MEDYAATLAS_VERSION &&
      String(window.MEDYAATLAS_VERSION).replace(/__/g, '') !==
        'MEDYAATLAS_VERSION' &&
      window.MEDYAATLAS_VERSION) ||
    '__MEDYAATLAS_VERSION__';

  // Damgalanmamış placeholder kalırsa version.json’dan oku.
  if (APP_VERSION.indexOf('__') !== -1) {
    APP_VERSION = '0.0.0';
  }

  var SW_URL = 'sw.js?v=' + encodeURIComponent(APP_VERSION);
  var CHECK_MS = 60000;
  var reloading = false;
  var registration = null;
  var bannerDismissedFor = null;

  var STR = {
    tr: {
      message: 'Yeni sürüm hazır',
      detail: 'Güncellemek için dokunun',
      update: 'Güncelle',
      dismiss: 'Kapat',
    },
    en: {
      message: 'Update available',
      detail: 'Tap to refresh',
      update: 'Update',
      dismiss: 'Dismiss',
    },
    de: {
      message: 'Update verfügbar',
      detail: 'Zum Aktualisieren tippen',
      update: 'Aktualisieren',
      dismiss: 'Schließen',
    },
  };

  function locale() {
    try {
      var lang = (navigator.language || 'tr').toLowerCase();
      if (lang.indexOf('de') === 0) return 'de';
      if (lang.indexOf('en') === 0) return 'en';
      return 'tr';
    } catch (_) {
      return 'tr';
    }
  }

  function t() {
    return STR[locale()] || STR.tr;
  }

  function compareVersions(a, b) {
    function parts(v) {
      return String(v)
        .split(/[^0-9]+/)
        .filter(Boolean)
        .map(function (x) {
          return parseInt(x, 10) || 0;
        });
    }
    var pa = parts(a);
    var pb = parts(b);
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = i < pa.length ? pa[i] : 0;
      var y = i < pb.length ? pb[i] : 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  function ensureBanner() {
    var el = document.getElementById('ma-update-banner');
    if (el) return el;

    var style = document.createElement('style');
    style.textContent =
      '#ma-update-banner{position:fixed;left:0;right:0;bottom:0;z-index:99999;' +
      'transform:translateY(110%);transition:transform .28s ease;' +
      'padding:12px 14px calc(12px + env(safe-area-inset-bottom,0px));' +
      'background:#0A1C28;border-top:1px solid rgba(46,196,182,.45);' +
      'box-shadow:0 -8px 28px rgba(0,0,0,.45);color:#e8eef2;' +
      'font-family:-apple-system,system-ui,sans-serif}' +
      '#ma-update-banner.ma-show{transform:translateY(0)}' +
      '#ma-update-banner .ma-row{display:flex;align-items:center;gap:12px;max-width:960px;margin:0 auto}' +
      '#ma-update-banner .ma-text{flex:1;min-width:0}' +
      '#ma-update-banner .ma-msg{font-size:15px;font-weight:650;margin:0}' +
      '#ma-update-banner .ma-detail{font-size:12px;opacity:.7;margin:2px 0 0}' +
      '#ma-update-banner .ma-btn{border:0;border-radius:10px;padding:10px 14px;' +
      'font-weight:700;font-size:14px;cursor:pointer}' +
      '#ma-update-banner .ma-update{background:#2EC4B6;color:#04201c}' +
      '#ma-update-banner .ma-dismiss{background:transparent;color:rgba(255,255,255,.75);padding:8px}';
    document.head.appendChild(style);

    el = document.createElement('div');
    el.id = 'ma-update-banner';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-hidden', 'true');
    var copy = t();
    el.innerHTML =
      '<div class="ma-row">' +
      '<div class="ma-text">' +
      '<p class="ma-msg"></p>' +
      '<p class="ma-detail"></p>' +
      '</div>' +
      '<button type="button" class="ma-btn ma-dismiss" aria-label="' +
      copy.dismiss +
      '">✕</button>' +
      '<button type="button" class="ma-btn ma-update"></button>' +
      '</div>';
    document.body.appendChild(el);

    el.querySelector('.ma-update').addEventListener('click', function () {
      applyUpdate();
    });
    el.querySelector('.ma-dismiss').addEventListener('click', function () {
      hideBanner(true);
    });
    return el;
  }

  function showBanner(reason) {
    if (bannerDismissedFor === APP_VERSION && reason === 'version') return;
    var el = ensureBanner();
    var copy = t();
    el.querySelector('.ma-msg').textContent = copy.message;
    el.querySelector('.ma-detail').textContent =
      copy.detail + (APP_VERSION && APP_VERSION !== '0.0.0' ? ' · v' + APP_VERSION : '');
    el.querySelector('.ma-update').textContent = copy.update;
    el.classList.add('ma-show');
    el.setAttribute('aria-hidden', 'false');
  }

  function hideBanner(userDismiss) {
    var el = document.getElementById('ma-update-banner');
    if (!el) return;
    if (userDismiss) bannerDismissedFor = APP_VERSION;
    el.classList.remove('ma-show');
    el.setAttribute('aria-hidden', 'true');
  }

  function hardReload() {
    if (reloading) return;
    reloading = true;
    var stamp = Date.now();
    var base = document.querySelector('base');
    var root = (base && base.href) || (location.origin + location.pathname.replace(/\/[^/]*$/, '/'));
    location.replace(root + (root.indexOf('?') >= 0 ? '&' : '?') + 't=' + stamp);
  }

  async function purgeCaches() {
    try {
      if (window.caches && caches.keys) {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }
    } catch (_) {}
  }

  async function applyUpdate() {
    try {
      if (registration && registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        // controllerchange → tek reload
        setTimeout(function () {
          if (!reloading) hardReload();
        }, 2500);
        return;
      }
      await purgeCaches();
      hardReload();
    } catch (_) {
      hardReload();
    }
  }

  function onControllerChange() {
    if (reloading) return;
    reloading = true;
    location.reload();
  }

  function trackWorker(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (
        worker.state === 'installed' &&
        navigator.serviceWorker.controller
      ) {
        showBanner('sw');
      }
    });
  }

  async function checkRemoteVersion() {
    try {
      var res = await fetch('version.json?t=' + Date.now(), {
        cache: 'no-store',
      });
      if (!res.ok) return;
      var json = await res.json();
      var remote = String(json.version || '')
        .replace(/^v/, '')
        .trim();
      if (!remote) return;
      if (compareVersions(remote, APP_VERSION) > 0) {
        showBanner('version');
      }
    } catch (_) {}
  }

  async function maybeHardReloadOnVersionMismatch() {
    try {
      var stored = localStorage.getItem('ma_app_version');
      if (stored && stored !== APP_VERSION && APP_VERSION !== '0.0.0') {
        if (!sessionStorage.getItem('ma_hard_reload_once')) {
          sessionStorage.setItem('ma_hard_reload_once', '1');
          await purgeCaches();
          hardReload();
          return true;
        }
      }
      if (APP_VERSION !== '0.0.0') {
        localStorage.setItem('ma_app_version', APP_VERSION);
      }
      sessionStorage.removeItem('ma_hard_reload_once');
    } catch (_) {}
    return false;
  }

  async function register() {
    if (!('serviceWorker' in navigator)) {
      await checkRemoteVersion();
      setInterval(checkRemoteVersion, CHECK_MS);
      return;
    }

    var bounced = await maybeHardReloadOnVersionMismatch();
    if (bounced) return;

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange,
    );

    try {
      registration = await navigator.serviceWorker.register(SW_URL, {
        scope: './',
      });
    } catch (e) {
      console.warn('MedyaAtlas SW register failed', e);
      await checkRemoteVersion();
      setInterval(checkRemoteVersion, CHECK_MS);
      return;
    }

    if (registration.waiting) {
      showBanner('sw');
    }
    trackWorker(registration.installing);
    registration.addEventListener('updatefound', function () {
      trackWorker(registration.installing);
    });

    await checkRemoteVersion();
    setInterval(function () {
      if (registration) registration.update().catch(function () {});
      checkRemoteVersion();
    }, CHECK_MS);

    // Flutter / ayarlar «Güncelleme kontrol et» için.
    window.MedyaAtlasUpdate = {
      check: function () {
        if (registration) registration.update().catch(function () {});
        return checkRemoteVersion();
      },
      show: showBanner,
      apply: applyUpdate,
      version: APP_VERSION,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register);
  } else {
    register();
  }
})();
