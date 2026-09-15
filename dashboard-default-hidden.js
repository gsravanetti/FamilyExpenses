(function () {
  'use strict';

  var DEFAULT_HIDDEN_TITLES = {
    palestra: true,
    nuoto: true,
    bici: true,
    smart: true
  };
  var SHOW_OVERRIDE_PREFIX = 'personal_os_show_default_hidden:';
  var cachedRows = Object.create(null);

  function normalizedTitle(row) {
    var title = row && row.querySelector('.item-title');
    return String(title ? title.textContent : '').trim().toLocaleLowerCase('it-IT');
  }

  function isDefaultHiddenRow(row) {
    return !!DEFAULT_HIDDEN_TITLES[normalizedTitle(row)];
  }

  function showOverrideKey(eventId) {
    return SHOW_OVERRIDE_PREFIX + eventId;
  }

  function isOverridden(eventId) {
    try {
      return localStorage.getItem(showOverrideKey(eventId)) === '1';
    } catch (e) {
      return false;
    }
  }

  function rememberOverride(eventId) {
    try {
      localStorage.setItem(showOverrideKey(eventId), '1');
    } catch (e) {}
  }

  function hasHiddenEvent(host, eventId) {
    if (!host) return false;
    var buttons = host.querySelectorAll('[data-remrestore],[data-auto-remrestore]');
    for (var i = 0; i < buttons.length; i++) {
      var id = buttons[i].getAttribute('data-remrestore') || buttons[i].getAttribute('data-auto-remrestore');
      if (id === eventId) return true;
    }
    return false;
  }

  function attachAutoRestore(button, eventId) {
    button.addEventListener('click', function () {
      button.classList.add('busy');
      button.disabled = true;
      rememberOverride(eventId);
      delete cachedRows[eventId];
      window.location.reload();
    });
  }

  function appendCachedToHidden() {
    var hiddenHost = document.getElementById('hiddenRemList');
    if (!hiddenHost) return;

    Object.keys(cachedRows).forEach(function (eventId) {
      if (hasHiddenEvent(hiddenHost, eventId)) return;
      var row = cachedRows[eventId].cloneNode(true);
      var button = row.querySelector('[data-remdone]');
      if (!button) return;
      button.removeAttribute('data-remdone');
      button.setAttribute('data-auto-remrestore', eventId);
      button.setAttribute('aria-label', 'Mostra di nuovo');
      attachAutoRestore(button, eventId);
      hiddenHost.appendChild(row);
    });
  }

  function processVisible() {
    var visibleHost = document.getElementById('remList');
    if (!visibleHost) return;

    var rows = visibleHost.querySelectorAll('.reminder-item');
    Array.prototype.forEach.call(rows, function (row) {
      if (!isDefaultHiddenRow(row)) return;
      var button = row.querySelector('[data-remdone]');
      if (!button) return;
      var eventId = button.getAttribute('data-remdone');
      if (!eventId || isOverridden(eventId)) return;

      cachedRows[eventId] = row.cloneNode(true);
      row.remove();
    });

    appendCachedToHidden();
  }

  function start() {
    var visibleHost = document.getElementById('remList');
    var hiddenHost = document.getElementById('hiddenRemList');
    if (!visibleHost || !hiddenHost || typeof MutationObserver !== 'function') return;

    var visibleTimer = null;
    var hiddenTimer = null;

    new MutationObserver(function () {
      clearTimeout(visibleTimer);
      visibleTimer = setTimeout(processVisible, 0);
    }).observe(visibleHost, { childList: true });

    new MutationObserver(function () {
      clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(appendCachedToHidden, 0);
    }).observe(hiddenHost, { childList: true });

    processVisible();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
