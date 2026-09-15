(function () {
  'use strict';

  var SPREADSHEET_ID = '1E6Lod_d0D0wOv3mrIErpSt9t5ntexGEnW-Ka0e4RXY0';
  var TODO_SHEET = 'ToDo';
  var COMPLETED_SHEET = 'ToDoCompleted';
  var SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function toast(message) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { el.classList.add('hidden'); }, 2800);
  }

  function api(url, options) {
    options = options || {};
    var proxyOptions = Object.assign({}, options, { credentials: 'same-origin' });
    proxyOptions.headers = Object.assign({'Content-Type':'application/json'}, options.headers || {});
    return fetch('/api/google?url=' + encodeURIComponent(url), proxyOptions).then(function (response) {
      return response.text().then(function (text) {
        var body = text ? JSON.parse(text) : {};
        if (!response.ok) {
          throw new Error((body.error && body.error.message) || body.error || ('Errore HTTP ' + response.status));
        }
        return body;
      });
    });
  }

  function sheetMeta() {
    return api(SHEETS + encodeURIComponent(SPREADSHEET_ID) + '?fields=sheets.properties(sheetId,title,index)');
  }

  function findSheet(meta, title) {
    var sheet = (meta.sheets || []).find(function (entry) {
      return entry.properties && entry.properties.title === title;
    });
    return sheet ? sheet.properties : null;
  }

  function addSheet(title) {
    return api(SHEETS + encodeURIComponent(SPREADSHEET_ID) + ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: title } } }] })
    });
  }

  function getValues(range) {
    return api(SHEETS + encodeURIComponent(SPREADSHEET_ID) + '/values/' + encodeURIComponent(range));
  }

  function updateValues(range, values) {
    return api(SHEETS + encodeURIComponent(SPREADSHEET_ID) + '/values/' + encodeURIComponent(range) + '?valueInputOption=RAW', {
      method: 'PUT',
      body: JSON.stringify({ range: range, majorDimension: 'ROWS', values: values })
    });
  }

  function appendValues(range, values) {
    return api(SHEETS + encodeURIComponent(SPREADSHEET_ID) + '/values/' + encodeURIComponent(range) + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', {
      method: 'POST',
      body: JSON.stringify({ values: values })
    });
  }

  function deleteTodoRow(sheetId, rowNumber) {
    return api(SHEETS + encodeURIComponent(SPREADSHEET_ID) + ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber
            }
          }
        }]
      })
    });
  }

  function ensureCompletedSheet() {
    return sheetMeta().then(function (meta) {
      if (findSheet(meta, COMPLETED_SHEET)) return meta;
      return addSheet(COMPLETED_SHEET).then(sheetMeta);
    }).then(function (meta) {
      return getValues(COMPLETED_SHEET + '!A1:E1').then(function (data) {
        if ((data.values || []).length) return meta;
        return updateValues(COMPLETED_SHEET + '!A1:E1', [[
          'ID', 'CreatedAt', 'CompletedAt', 'Title', 'Note'
        ]]).then(function () { return meta; });
      });
    });
  }

  function activeTodo(rowNumber) {
    return getValues(TODO_SHEET + '!A' + rowNumber + ':D' + rowNumber).then(function (data) {
      var row = (data.values || [])[0] || [];
      if (!row[2]) throw new Error('To do non trovato. Aggiorna la dashboard e riprova.');
      return {
        id: row[0] || ('legacy_' + rowNumber + '_' + Date.now()),
        createdAt: row[1] || '',
        title: row[2] || '',
        note: row[3] || ''
      };
    });
  }

  function archiveTodo(rowNumber) {
    var meta;
    var todo;
    return ensureCompletedSheet().then(function (freshMeta) {
      meta = freshMeta;
      if (!findSheet(meta, TODO_SHEET)) throw new Error('Foglio ToDo non trovato.');
      return activeTodo(rowNumber);
    }).then(function (item) {
      todo = item;
      return getValues(COMPLETED_SHEET + '!A2:A');
    }).then(function (completedIds) {
      var exists = (completedIds.values || []).some(function (row) {
        return String(row[0] || '') === String(todo.id);
      });
      if (exists) return null;
      return appendValues(COMPLETED_SHEET + '!A:E', [[
        todo.id,
        todo.createdAt,
        new Date().toISOString(),
        todo.title,
        todo.note
      ]]);
    }).then(function () {
      return deleteTodoRow(findSheet(meta, TODO_SHEET).sheetId, rowNumber);
    });
  }

  function normalizeActiveRowsAfterDelete(deletedRow) {
    var buttons = document.querySelectorAll('#todoList [data-tododone]');
    Array.prototype.forEach.call(buttons, function (button) {
      var row = Number(button.getAttribute('data-tododone'));
      if (row > deletedRow) button.setAttribute('data-tododone', String(row - 1));
    });
  }

  function handleTodoCompletion(event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-tododone]') : null;
    if (!button || !document.getElementById('todoList').contains(button)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled || button.getAttribute('data-completing') === '1') return;

    var rowNumber = Number(button.getAttribute('data-tododone'));
    if (!rowNumber) return;

    button.setAttribute('data-completing', '1');
    button.classList.add('busy');
    button.disabled = true;

    archiveTodo(rowNumber).then(function () {
      var item = button.closest('.item');
      if (item) item.remove();
      normalizeActiveRowsAfterDelete(rowNumber);
      var list = document.getElementById('todoList');
      if (list && !list.querySelector('.item')) {
        list.innerHTML = '<div class="empty"><div class="empty-glyph">✓</div>Nessun To do aperto.</div>';
      }
      toast('To do completato e archiviato.');
    }).catch(function (error) {
      button.removeAttribute('data-completing');
      button.classList.remove('busy');
      button.disabled = false;
      toast(error.message);
    });
  }

  function formatCompletedAt(raw) {
    var date = new Date(raw);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('it-IT', {
      day: '2-digit', month: 'short', year: 'numeric'
    }) + ' · ' + date.toLocaleTimeString('it-IT', {
      hour: '2-digit', minute: '2-digit'
    });
  }

  function loadCompleted() {
    var list = document.getElementById('completedTodoList');
    if (!list) return Promise.resolve();
    list.innerHTML = '<div class="loader"><span class="spin"></span>Caricamento…</div>';

    return ensureCompletedSheet().then(function () {
      return getValues(COMPLETED_SHEET + '!A2:E');
    }).then(function (data) {
      var items = (data.values || []).map(function (row) {
        return {
          id: row[0] || '',
          createdAt: row[1] || '',
          completedAt: row[2] || '',
          title: row[3] || '',
          note: row[4] || ''
        };
      }).filter(function (item) { return item.title; });

      items.sort(function (a, b) {
        return (new Date(b.completedAt).getTime() || 0) - (new Date(a.completedAt).getTime() || 0);
      });

      if (!items.length) {
        list.innerHTML = '<div class="empty"><div class="empty-glyph">✓</div>Nessun To do completato.</div>';
        return;
      }

      list.innerHTML = items.map(function (item) {
        var sub = 'Completato ' + formatCompletedAt(item.completedAt);
        if (item.note) sub += ' · ' + item.note;
        return '<div class="item completed-item">' +
          '<span class="completed-check" aria-hidden="true">✓</span>' +
          '<div class="item-main"><div class="item-title">' + esc(item.title) + '</div>' +
          '<div class="item-sub">' + esc(sub) + '</div></div></div>';
      }).join('');
    }).catch(function (error) {
      list.innerHTML = '<div class="empty"><div class="empty-glyph">!</div>Errore di caricamento.</div>';
      toast(error.message);
    });
  }

  function closeCompleted() {
    var screen = document.getElementById('completedScreen');
    if (!screen) return;
    screen.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function openCompleted() {
    var screen = document.getElementById('completedScreen');
    if (!screen) return;
    screen.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    loadCompleted();
  }

  function installCompletedUi() {
    if (document.getElementById('completedBtn')) return;

    var grid = document.querySelector('.action-grid');
    if (grid) {
      var button = document.createElement('button');
      button.className = 'action-btn';
      button.id = 'completedBtn';
      button.type = 'button';
      button.setAttribute('aria-label', 'To do completati');
      button.innerHTML = '<span class="action-icon">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6"/></svg>' +
        '</span>Completed';
      button.addEventListener('click', openCompleted);
      grid.appendChild(button);
    }

    var screen = document.createElement('div');
    screen.className = 'hidden-screen hidden';
    screen.id = 'completedScreen';
    screen.setAttribute('role', 'dialog');
    screen.setAttribute('aria-modal', 'true');
    screen.setAttribute('aria-labelledby', 'completedTitle');
    screen.innerHTML = '<div class="shell">' +
      '<header class="topbar">' +
      '<button class="btn hidden-back" id="closeCompleted" type="button">← Dashboard</button>' +
      '<div class="brand"><div><div class="eyebrow">Personal OS</div><h1 id="completedTitle">Completed</h1></div></div>' +
      '</header>' +
      '<article class="panel">' +
      '<div class="panel-head">' +
      '<div class="panel-icon todo">✓</div>' +
      '<div class="panel-title"><h2>To do completati</h2><p>Dal più recente al più vecchio</p></div>' +
      '</div>' +
      '<div class="list" id="completedTodoList"><div class="empty"><div class="empty-glyph">✓</div>Nessun To do completato.</div></div>' +
      '</article></div>';
    document.body.appendChild(screen);

    var closeButton = document.getElementById('closeCompleted');
    if (closeButton) closeButton.addEventListener('click', closeCompleted);
  }

  document.addEventListener('click', handleTodoCompletion, true);
  document.addEventListener('keydown', function (event) {
    var screen = document.getElementById('completedScreen');
    if (event.key === 'Escape' && screen && !screen.classList.contains('hidden')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeCompleted();
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installCompletedUi);
  } else {
    installCompletedUi();
  }
})();
