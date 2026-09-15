(function () {
  'use strict';

  var completionInFlight = false;

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

  function completedApi(method, body) {
    var options = {
      method: method,
      credentials: 'same-origin',
      cache: 'no-store'
    };
    if (body !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }

    return fetch('/api/todo-completed', options).then(function (response) {
      return response.text().then(function (text) {
        var payload = text ? JSON.parse(text) : {};
        if (!response.ok) {
          throw new Error(payload.error || ('Errore HTTP ' + response.status));
        }
        return payload;
      });
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
    var todoList = document.getElementById('todoList');
    if (!button || !todoList || !todoList.contains(button)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled || button.getAttribute('data-completing') === '1') return;
    if (completionInFlight) {
      toast('Attendi il completamento del To do precedente.');
      return;
    }

    var rowNumber = Number(button.getAttribute('data-tododone'));
    if (!rowNumber) return;
    var item = button.closest('.item');
    var titleNode = item ? item.querySelector('.item-title') : null;
    var expectedTitle = titleNode ? titleNode.textContent.trim() : '';

    completionInFlight = true;
    button.setAttribute('data-completing', '1');
    button.classList.add('busy');
    button.disabled = true;

    completedApi('POST', { rowNumber: rowNumber, title: expectedTitle }).then(function () {
      if (item) item.remove();
      normalizeActiveRowsAfterDelete(rowNumber);
      if (!todoList.querySelector('.item')) {
        todoList.innerHTML = '<div class="empty"><div class="empty-glyph">✓</div>Nessun To do aperto.</div>';
      }
      toast('To do completato e archiviato.');
      completionInFlight = false;
    }).catch(function (error) {
      completionInFlight = false;
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

  function renderCompleted(items) {
    var list = document.getElementById('completedTodoList');
    if (!list) return;
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
  }

  function loadCompleted() {
    var list = document.getElementById('completedTodoList');
    if (!list) return Promise.resolve();
    list.innerHTML = '<div class="loader"><span class="spin"></span>Caricamento…</div>';

    return completedApi('GET').then(function (payload) {
      renderCompleted(payload.items || []);
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
