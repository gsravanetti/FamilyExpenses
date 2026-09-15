(function () {
  'use strict';

  var sessionAuthenticated = false;

  function currentReturnTo() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function sharedLogin() {
    window.location.href = '/api/auth/login?returnTo=' + encodeURIComponent(currentReturnTo());
  }

  function sessionStatus() {
    return fetch('/api/auth/session', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    }).then(function (r) {
      if (!r.ok) throw new Error('Impossibile verificare la sessione.');
      return r.json();
    }).then(function (body) {
      sessionAuthenticated = !!body.authenticated;
      return sessionAuthenticated;
    }).catch(function () {
      sessionAuthenticated = false;
      return false;
    });
  }

  function proxyJson(url) {
    return fetch('/api/finance?url=' + encodeURIComponent(url), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store'
    }).then(function (r) {
      return r.text().then(function (text) {
        var body = text ? JSON.parse(text) : {};
        if (r.status === 401) sessionAuthenticated = false;
        if (!r.ok) {
          var msg = body && body.error && body.error.message
            ? body.error.message
            : (body && body.error ? body.error : ('HTTP ' + r.status));
          var err = new Error(msg);
          err.status = r.status;
          throw err;
        }
        return body;
      });
    });
  }

  var EPOCA_SERIALE = Date.UTC(1899, 11, 30);
  function serialeADate(n) {
    return new Date(EPOCA_SERIALE + Math.round(n * 86400000));
  }

  function convertiColonneData(rows) {
    var headerRow = -1;
    for (var r = 0; r < Math.min(rows.length, 10) && headerRow < 0; r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        var t = String(row[c] == null ? '' : row[c]).toLowerCase().trim();
        if (t === 'data' || t === 'mese') {
          headerRow = r;
          break;
        }
      }
    }
    if (headerRow < 0) return rows;

    var cols = [];
    (rows[headerRow] || []).forEach(function (v, c) {
      var t = String(v == null ? '' : v).toLowerCase().trim();
      if (t === 'data' || t === 'mese') cols.push(c);
    });

    for (var i = headerRow + 1; i < rows.length; i++) {
      var rr = rows[i];
      if (!rr) continue;
      cols.forEach(function (c) {
        var v = rr[c];
        if (typeof v === 'number' && v > 20000 && v < 80000) rr[c] = serialeADate(v);
      });
    }
    return rows;
  }

  function financeWorkbook(spreadsheetId) {
    var base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId);
    var fogli = CONFIG.fogli;
    var tutti = [fogli.spese, fogli.budget, fogli.stipendiJack, fogli.stipendiOtti];

    return proxyJson(base + '?fields=' + encodeURIComponent('sheets.properties.title'))
      .then(function (meta) {
        var presentiMap = {};
        (meta.sheets || []).forEach(function (s) {
          if (s.properties && s.properties.title) presentiMap[s.properties.title] = true;
        });
        var presenti = tutti.filter(function (n) { return presentiMap[n]; });
        if (!presenti.length) {
          return {
            has: function () { return false; },
            rows: function () { return Promise.resolve([]); }
          };
        }

        var qs = presenti.map(function (n) {
          return 'ranges=' + encodeURIComponent("'" + n.replace(/'/g, "''") + "'");
        }).join('&');
        var url = base + '/values:batchGet?' + qs +
          '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';

        return proxyJson(url).then(function (json) {
          var data = {};
          (json.valueRanges || []).forEach(function (vr, i) {
            data[presenti[i]] = convertiColonneData(vr.values || []);
          });
          return {
            has: function (name) { return !!data[name]; },
            rows: function (name) { return Promise.resolve(data[name] || []); }
          };
        });
      });
  }

  window.GoogleAuth = {
    configurato: function () { return true; },
    attivo: function () { return sessionAuthenticated; },
    ottieniToken: function () {
      if (sessionAuthenticated) return Promise.resolve('shared-session');
      return sessionStatus().then(function (ok) {
        if (!ok) {
          var err = new Error('Sessione non valida. Accedi di nuovo.');
          err.status = 401;
          throw err;
        }
        return 'shared-session';
      });
    },
    esci: function () {
      sessionAuthenticated = false;
      fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true
      }).catch(function () {});
    }
  };

  window.GSheetsApi = {
    open: function (spreadsheetId) {
      if (!spreadsheetId) return Promise.reject(new Error('Manca lo Spreadsheet ID del Google Sheet.'));
      return financeWorkbook(spreadsheetId);
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    var login = document.getElementById('btnLogin');
    var reload = document.getElementById('btnReload');
    var logout = document.getElementById('btnLogout');
    var loaderText = document.querySelector('#loader > p');
    var hint = document.querySelector('#loader .hint');
    var loadMsg = document.getElementById('loadMsg');

    if (loaderText) loaderText.textContent = 'Le tue spese e il tuo budget, protetti dallo stesso accesso della dashboard.';
    if (hint) hint.textContent = 'L’accesso è condiviso con la dashboard principale. Se hai già effettuato il login su questo dispositivo, Finance si apre automaticamente senza chiederti di accedere di nuovo.';

    if (login) {
      login.addEventListener('click', function (ev) {
        if (sessionAuthenticated) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        sharedLogin();
      }, true);
    }

    if (reload) {
      reload.addEventListener('click', function (ev) {
        if (sessionAuthenticated) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        sharedLogin();
      }, true);
    }

    if (loadMsg) loadMsg.textContent = '';

    sessionStatus().then(function (ok) {
      if (!login || !reload || !logout) return;
      if (!ok) {
        login.disabled = false;
        reload.disabled = true;
        logout.disabled = true;
        if (loadMsg) loadMsg.innerHTML = '<div class="msg info">Accedi con lo stesso account della dashboard principale.</div>';
        return;
      }

      login.disabled = false;
      reload.disabled = false;
      logout.disabled = false;
      login.click();
      login.disabled = true;
    });
  });
})();
