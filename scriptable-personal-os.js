// PERSONAL OS — Scriptable multi-widget
// Add the same script 3 times and set Widget Parameter to:
// todo | reminder | finance

const CONFIG = {
  apiUrl: 'https://family-expenses.gs-ravanetti.workers.dev/api/widget',
  baseUrl: 'https://family-expenses.gs-ravanetti.workers.dev/',
  financeUrl: 'https://family-expenses.gs-ravanetti.workers.dev/finance.html',
  tokenKey: 'personal_os_widget_token_v2',
  cacheFile: 'personal-os-widget-cache-v2.json',
  requestedRefreshMinutes: 30
};

const queryMode = args.queryParameters && args.queryParameters.mode
  ? args.queryParameters.mode
  : null;
const mode = String(queryMode || args.widgetParameter || 'todo').toLowerCase();

const token = await getToken();
const result = await loadData(token);
const widget = buildWidget(mode, result);

const nextRefresh = new Date();
nextRefresh.setMinutes(nextRefresh.getMinutes() + CONFIG.requestedRefreshMinutes);
widget.refreshAfterDate = nextRefresh;
Script.setWidget(widget);

if (!config.runsInWidget) await widget.presentMedium();
Script.complete();

// ============================================================
// TOKEN
// ============================================================

async function getToken() {
  if (Keychain.contains(CONFIG.tokenKey)) return Keychain.get(CONFIG.tokenKey);
  if (config.runsInWidget) return null;

  const alert = new Alert();
  alert.title = 'Personal OS';
  alert.message = 'Inserisci WIDGET_TOKEN. Verrà salvato nel Keychain di iOS.';
  alert.addSecureTextField('Widget token', '');
  alert.addAction('Salva');
  alert.addCancelAction('Annulla');

  const action = await alert.presentAlert();
  if (action === -1) return null;

  const value = alert.textFieldValue(0).trim();
  if (!value) return null;

  Keychain.set(CONFIG.tokenKey, value);
  return value;
}

// ============================================================
// API
// ============================================================

async function loadData(token) {
  if (!token) return { source: 'error', error: 'Token widget mancante.' };

  try {
    const req = new Request(CONFIG.apiUrl);
    req.method = 'GET';
    req.timeoutInterval = 15;
    req.headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    };

    const data = await req.loadJSON();
    const status = req.response ? Number(req.response.statusCode || 0) : 0;

    if (status && (status < 200 || status >= 300)) {
      throw new Error(`HTTP ${status}: ${data && data.error ? data.error : 'errore API'}`);
    }

    if (!isValidPayload(data)) {
      throw new Error(data && data.error ? data.error : 'Risposta API incompleta o non valida.');
    }

    saveCache(data);
    return { source: 'live', data };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    console.log('Widget API error: ' + message);

    const cached = loadCache();
    if (isValidPayload(cached)) {
      return { source: 'cache', data: cached, error: message };
    }

    return { source: 'error', error: message };
  }
}

function isValidPayload(data) {
  return !!(
    data &&
    typeof data === 'object' &&
    data.version === 1 &&
    data.updatedAt &&
    data.todo &&
    data.reminder &&
    data.finance
  );
}

// ============================================================
// WIDGET
// ============================================================

function buildWidget(mode, result) {
  const widget = new ListWidget();
  widget.setPadding(14, 15, 12, 15);
  widget.backgroundColor = Color.dynamic(
    new Color('#F5F5F7'),
    new Color('#171717')
  );

  addHeader(widget, mode, result.source);
  widget.addSpacer(mode === 'finance' ? 10 : 7);

  if (result.source === 'error') {
    buildError(widget, result.error);
    widget.url = CONFIG.baseUrl;
    return widget;
  }

  const data = result.data;

  if (mode === 'reminder') {
    buildReminder(widget, data.reminder || {});
    widget.url = CONFIG.baseUrl;
  } else if (mode === 'finance') {
    buildFinance(widget, data.finance || {});
    widget.url = CONFIG.financeUrl;
    widget.addSpacer();
    addUpdated(widget, data.updatedAt);
  } else {
    buildTodo(widget, data.todo || {});
    widget.url = CONFIG.baseUrl;
  }

  return widget;
}

// ============================================================
// HEADER + REFRESH
// ============================================================

function addHeader(widget, mode, source) {
  const row = widget.addStack();
  row.centerAlignContent();

  const titleText = mode === 'finance'
    ? 'FINANCE'
    : mode === 'reminder'
      ? 'REMINDER'
      : 'TASK';

  const title = row.addText(titleText);
  title.font = Font.semiboldSystemFont(12);
  title.textColor = Color.dynamic(
    new Color('#4B5563'),
    new Color('#D1D5DB')
  );

  row.addSpacer();

  const sourceText = source === 'live'
    ? 'LIVE'
    : source === 'cache'
      ? 'CACHE'
      : 'ERROR';

  const status = row.addText(sourceText);
  status.font = Font.boldSystemFont(8);
  status.textColor = Color.dynamic(
    new Color('#9CA3AF'),
    new Color('#7D8590')
  );

  if (mode === 'todo' || mode === 'reminder') {
    row.addSpacer(9);
    addRefreshButton(row, mode);
  }
}

function addRefreshButton(row, mode) {
  const hit = row.addStack();
  hit.centerAlignContent();
  hit.url = makeRefreshUrl(mode);

  const symbol = SFSymbol.named('arrow.clockwise');
  symbol.applyFont(Font.mediumSystemFont(12));

  const image = hit.addImage(symbol.image);
  image.imageSize = new Size(13, 13);
  image.tintColor = Color.dynamic(
    new Color('#6B7280'),
    new Color('#A3A3A3')
  );
}

function makeRefreshUrl(mode) {
  return `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&mode=${encodeURIComponent(mode)}`;
}

// ============================================================
// ERROR VIEW
// ============================================================

function buildError(widget, message) {
  const title = widget.addText('Sincronizzazione non riuscita');
  title.font = Font.boldSystemFont(15);
  title.textColor = Color.dynamic(Color.black(), Color.white());

  widget.addSpacer(7);

  const body = widget.addText(String(message || 'Errore sconosciuto'));
  body.font = Font.systemFont(10);
  body.lineLimit = 5;
  body.textColor = Color.dynamic(
    new Color('#666666'),
    new Color('#AAAAAA')
  );
}

// ============================================================
// TASK — 2 COLONNE, 6 TASK, TESTO SU 2 RIGHE
// ============================================================

function buildTodo(widget, todo) {
  const items = Array.isArray(todo.items) ? todo.items.slice(0, 6) : [];

  if (!items.length) {
    return addEmpty(widget, 'Nessun task aperto');
  }

  for (let i = 0; i < 3; i++) {
    const row = widget.addStack();
    row.layoutHorizontally();

    const left = items[i * 2];
    const right = items[i * 2 + 1];

    addTaskCell(row, left);
    row.addSpacer(10);
    addTaskCell(row, right);

    if (i < 2) widget.addSpacer(6);
  }
}

function addTaskCell(row, item) {
  const cell = row.addStack();
  cell.layoutHorizontally();
  cell.topAlignContent();
  cell.size = new Size(140, 31);

  if (!item) return;

  const check = cell.addText('✓');
  check.font = Font.boldSystemFont(10);
  check.textColor = Color.dynamic(
    new Color('#10B981'),
    new Color('#34D399')
  );

  cell.addSpacer(6);

  const title = cell.addText(String(item.title || ''));
  title.font = Font.semiboldSystemFont(10.5);
  title.lineLimit = 2;
  title.minimumScaleFactor = 0.82;
  title.textColor = Color.dynamic(Color.black(), Color.white());
}

// ============================================================
// REMINDER — TIMELINE
// ============================================================

function buildReminder(widget, reminder) {
  const items = Array.isArray(reminder.items) ? reminder.items.slice(0, 4) : [];

  if (!items.length) {
    return addEmpty(widget, 'Nessun reminder aperto');
  }

  items.forEach((item, index) => {
    addTimelineRow(widget, item, index === items.length - 1);
    if (index < items.length - 1) widget.addSpacer(2);
  });
}

function addTimelineRow(widget, item, isLast) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const rail = row.addStack();
  rail.layoutVertically();
  rail.centerAlignContent();
  rail.size = new Size(15, 26);

  rail.addSpacer(1);

  const dot = rail.addText('●');
  dot.font = Font.systemFont(8);
  dot.textColor = reminderAccent(item);

  if (!isLast) {
    const lineRow = rail.addStack();
    lineRow.layoutHorizontally();
    lineRow.addSpacer(6.5);
    const line = lineRow.addStack();
    line.size = new Size(1, 14);
    line.backgroundColor = Color.dynamic(
      new Color('#D1D5DB'),
      new Color('#4B5563')
    );
    lineRow.addSpacer();
  }

  row.addSpacer(6);

  const when = row.addStack();
  when.layoutVertically();
  when.size = new Size(55, 25);

  const dateText = when.addText(reminderDate(item));
  dateText.font = Font.semiboldSystemFont(9.5);
  dateText.lineLimit = 1;
  dateText.textColor = Color.dynamic(
    new Color('#374151'),
    new Color('#D1D5DB')
  );

  const timeText = reminderTime(item);
  if (timeText) {
    const time = when.addText(timeText);
    time.font = Font.systemFont(8.5);
    time.lineLimit = 1;
    time.textColor = Color.dynamic(
      new Color('#9CA3AF'),
      new Color('#7D8590')
    );
  }

  row.addSpacer(7);

  const title = row.addText(String(item.title || ''));
  title.font = Font.semiboldSystemFont(10.5);
  title.lineLimit = 2;
  title.minimumScaleFactor = 0.84;
  title.textColor = Color.dynamic(Color.black(), Color.white());
}

function reminderDate(item) {
  if (!item || !item.start) return '—';
  const d = new Date(item.start);
  if (isNaN(d.getTime())) return '—';

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (sameCalendarDay(d, today)) return 'Oggi';
  if (sameCalendarDay(d, tomorrow)) return 'Domani';

  return d.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'short'
  });
}

function reminderTime(item) {
  if (!item || !item.start || item.allDay) return '';
  const d = new Date(item.start);
  if (isNaN(d.getTime())) return '';

  return d.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function reminderAccent(item) {
  if (!item || !item.start) return new Color('#60A5FA');

  const d = new Date(item.start);
  if (isNaN(d.getTime())) return new Color('#60A5FA');

  const now = new Date();
  const diffDays = (d.getTime() - now.getTime()) / 86400000;

  if (sameCalendarDay(d, now)) return new Color('#EF4444');
  if (diffDays <= 7) return new Color('#F59E0B');
  return new Color('#3B82F6');
}

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// ============================================================
// FINANCE — INVARIATO
// ============================================================

function buildFinance(widget, finance) {
  const period = widget.addText(finance.periodLabel || 'Questo mese');
  period.font = Font.systemFont(10);
  period.textColor = Color.dynamic(
    new Color('#777777'),
    new Color('#999999')
  );

  widget.addSpacer(5);

  const row = widget.addStack();
  row.layoutHorizontally();

  const left = row.addStack();
  left.layoutVertically();
  addMetric(left, 'Spese', formatEuro(finance.monthExpenses));

  row.addSpacer();

  const right = row.addStack();
  right.layoutVertically();
  addMetric(right, 'Residuo budget', formatEuro(finance.budgetRemaining));

  widget.addSpacer(9);

  const pct = finance.budgetUsedPct == null
    ? '—'
    : `${finance.budgetUsedPct}%`;

  const foot = widget.addText(
    `${pct} del budget · ${Number(finance.transactionsThisMonth || 0)} movimenti`
  );
  foot.font = Font.systemFont(10);
  foot.textColor = Color.dynamic(
    new Color('#666666'),
    new Color('#AAAAAA')
  );
}

function addMetric(stack, labelText, valueText) {
  const label = stack.addText(labelText);
  label.font = Font.systemFont(10);
  label.textColor = Color.dynamic(
    new Color('#777777'),
    new Color('#999999')
  );

  const value = stack.addText(valueText);
  value.font = Font.boldSystemFont(21);
  value.minimumScaleFactor = 0.65;
  value.textColor = Color.dynamic(Color.black(), Color.white());
}

// ============================================================
// COMMON
// ============================================================

function addEmpty(widget, text) {
  const t = widget.addText(text);
  t.font = Font.systemFont(11);
  t.textColor = Color.dynamic(
    new Color('#888888'),
    new Color('#888888')
  );
}

function addUpdated(widget, value) {
  const t = widget.addText('Aggiornato ' + formatUpdatedAt(value));
  t.font = Font.systemFont(8);
  t.textColor = Color.dynamic(
    new Color('#AAAAAA'),
    new Color('#777777')
  );
}

function formatEuro(value) {
  return Number(value || 0).toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  });
}

function formatUpdatedAt(value) {
  if (!value) return '—';
  const d = new Date(value);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// CACHE
// ============================================================

function saveCache(data) {
  try {
    const fm = FileManager.local();
    const path = fm.joinPath(fm.documentsDirectory(), CONFIG.cacheFile);
    fm.writeString(path, JSON.stringify(data));
  } catch (error) {
    console.log('Cache write error: ' + error);
  }
}

function loadCache() {
  try {
    const fm = FileManager.local();
    const path = fm.joinPath(fm.documentsDirectory(), CONFIG.cacheFile);
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch (error) {
    console.log('Cache read error: ' + error);
    return null;
  }
}
