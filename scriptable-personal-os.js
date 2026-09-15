// PERSONAL OS — Scriptable multi-widget
// Widget Parameter: todo | reminder | finance

const CONFIG = {
  apiUrl: 'https://family-expenses.gs-ravanetti.workers.dev/api/widget',
  baseUrl: 'https://family-expenses.gs-ravanetti.workers.dev/',
  financeUrl: 'https://family-expenses.gs-ravanetti.workers.dev/finance.html',
  tokenKey: 'personal_os_widget_token_v2',
  cacheFile: 'personal-os-widget-cache-v3.json',
  requestedRefreshMinutes: 30
};

const COLORS = {
  bgLight: '#F4F7FB',
  bgDark: '#171717',
  ink: '#1F2937',
  inkSoft: '#64748B',
  inkFaint: '#94A3B8',
  line: '#D9E2EE',
  blue: '#2563EB',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#EF4444'
};

const queryMode = args.queryParameters && args.queryParameters.mode ? args.queryParameters.mode : null;
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

async function loadData(token) {
  if (!token) return { source: 'error', error: 'Token widget mancante.' };

  try {
    const req = new Request(CONFIG.apiUrl);
    req.method = 'GET';
    req.timeoutInterval = 15;
    req.headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

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
    if (isValidPayload(cached)) return { source: 'cache', data: cached, error: message };
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

function buildWidget(mode, result) {
  const widget = new ListWidget();
  widget.setPadding(14, 15, 12, 15);
  widget.backgroundColor = Color.dynamic(new Color(COLORS.bgLight), new Color(COLORS.bgDark));

  addHeader(widget, mode);
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
  } else {
    buildTodo(widget, data.todo || {});
    widget.url = CONFIG.baseUrl;
  }

  return widget;
}

function addHeader(widget, mode) {
  const row = widget.addStack();
  row.centerAlignContent();

  const titleText = mode === 'finance' ? 'FINANCE' : mode === 'reminder' ? 'REMINDER' : 'TASK';
  const title = row.addText(titleText);
  title.font = Font.semiboldSystemFont(12);
  title.textColor = Color.dynamic(new Color(COLORS.ink), Color.white());

  row.addSpacer();

  if (mode === 'todo' || mode === 'reminder') {
    addRefreshButton(row, mode);
  }
}

function addRefreshButton(row, mode) {
  const button = row.addStack();
  button.layoutHorizontally();
  button.centerAlignContent();
  button.backgroundColor = new Color(COLORS.blue);
  button.cornerRadius = 7;
  button.setPadding(5, 8, 5, 8);
  button.url = makeRefreshUrl(mode);

  const symbol = SFSymbol.named('arrow.clockwise');
  symbol.applyFont(Font.semiboldSystemFont(9));
  const image = button.addImage(symbol.image);
  image.imageSize = new Size(10, 10);
  image.tintColor = Color.white();

  button.addSpacer(4);

  const label = button.addText('REFRESH');
  label.font = Font.boldSystemFont(8);
  label.textColor = Color.white();
}

function makeRefreshUrl(mode) {
  return `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&mode=${encodeURIComponent(mode)}`;
}

function buildError(widget, message) {
  const title = widget.addText('Sincronizzazione non riuscita');
  title.font = Font.boldSystemFont(15);
  title.textColor = Color.dynamic(new Color(COLORS.ink), Color.white());
  widget.addSpacer(7);

  const body = widget.addText(String(message || 'Errore sconosciuto'));
  body.font = Font.systemFont(10);
  body.lineLimit = 5;
  body.textColor = Color.dynamic(new Color(COLORS.inkSoft), new Color('#AAAAAA'));
}

// iOS widgets are static, not scrollable. Show as many rows as fit by family.
function maxVisibleRows(kind) {
  const family = config.widgetFamily || 'medium';
  if (family === 'large') return kind === 'todo' ? 10 : 9;
  if (family === 'small') return kind === 'todo' ? 3 : 3;
  return kind === 'todo' ? 5 : 4;
}

function buildTodo(widget, todo) {
  const all = Array.isArray(todo.items) ? todo.items : [];
  const limit = maxVisibleRows('todo');
  const items = all.slice(0, limit);

  if (!items.length) return addEmpty(widget, 'Nessun task aperto');

  items.forEach((item, index) => {
    addTaskRow(widget, item);
    if (index < items.length - 1) widget.addSpacer(5);
  });

  addMoreRow(widget, all.length - items.length);
}

function addTaskRow(widget, item) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.topAlignContent();

  const mark = row.addStack();
  mark.size = new Size(16, 16);
  mark.cornerRadius = 5;
  mark.backgroundColor = new Color(COLORS.blue);
  mark.centerAlignContent();

  const symbol = SFSymbol.named('checkmark');
  symbol.applyFont(Font.boldSystemFont(8));
  const image = mark.addImage(symbol.image);
  image.imageSize = new Size(8, 8);
  image.tintColor = Color.white();

  row.addSpacer(8);

  const title = row.addText(String(item.title || ''));
  title.font = Font.semiboldSystemFont(11);
  title.lineLimit = 2;
  title.minimumScaleFactor = 0.86;
  title.textColor = Color.dynamic(new Color(COLORS.ink), Color.white());
}

function buildReminder(widget, reminder) {
  const all = Array.isArray(reminder.items) ? reminder.items : [];
  const limit = maxVisibleRows('reminder');
  const items = all.slice(0, limit);

  if (!items.length) return addEmpty(widget, 'Nessun reminder aperto');

  items.forEach((item, index) => {
    addTimelineRow(widget, item, index === items.length - 1);
    if (index < items.length - 1) widget.addSpacer(1);
  });

  addMoreRow(widget, all.length - items.length);
}

function addTimelineRow(widget, item, isLast) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const rail = row.addStack();
  rail.layoutVertically();
  rail.centerAlignContent();
  rail.size = new Size(13, 27);

  const dot = rail.addText('●');
  dot.font = Font.systemFont(7.5);
  dot.textColor = reminderAccent(item);

  if (!isLast) {
    const lineRow = rail.addStack();
    lineRow.layoutHorizontally();
    lineRow.addSpacer(5.5);
    const line = lineRow.addStack();
    line.size = new Size(1, 16);
    line.backgroundColor = Color.dynamic(new Color(COLORS.line), new Color('#4B5563'));
    lineRow.addSpacer();
  }

  row.addSpacer(4);

  const when = row.addStack();
  when.layoutVertically();
  when.size = new Size(47, 26);

  const date = when.addText(reminderDate(item));
  date.font = Font.semiboldSystemFont(9.5);
  date.lineLimit = 1;
  date.textColor = Color.dynamic(new Color(COLORS.inkSoft), new Color('#D1D5DB'));

  const timeText = reminderTime(item);
  if (timeText) {
    const time = when.addText(timeText);
    time.font = Font.systemFont(8);
    time.lineLimit = 1;
    time.textColor = Color.dynamic(new Color(COLORS.inkFaint), new Color('#7D8590'));
  }

  row.addSpacer(3);

  const title = row.addText(String(item.title || ''));
  title.font = Font.semiboldSystemFont(10.5);
  title.lineLimit = 2;
  title.minimumScaleFactor = 0.82;
  title.textColor = Color.dynamic(new Color(COLORS.ink), Color.white());
}

function addMoreRow(widget, remaining) {
  if (remaining <= 0) return;
  widget.addSpacer(5);
  const more = widget.addText(`+ ${remaining} altri`);
  more.font = Font.semiboldSystemFont(9);
  more.textColor = new Color(COLORS.blue);
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

  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
}

function reminderTime(item) {
  if (!item || !item.start || item.allDay) return '';
  const d = new Date(item.start);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function reminderAccent(item) {
  if (!item || !item.start) return new Color(COLORS.blue);
  const d = new Date(item.start);
  if (isNaN(d.getTime())) return new Color(COLORS.blue);

  const now = new Date();
  const diffDays = (d.getTime() - now.getTime()) / 86400000;

  if (sameCalendarDay(d, now)) return new Color(COLORS.red);
  if (diffDays <= 7) return new Color(COLORS.amber);
  return new Color(COLORS.blue);
}

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function buildFinance(widget, finance) {
  const period = widget.addText(finance.periodLabel || 'Questo mese');
  period.font = Font.systemFont(10);
  period.textColor = Color.dynamic(new Color(COLORS.inkSoft), new Color('#999999'));

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

  const pct = finance.budgetUsedPct == null ? '—' : `${finance.budgetUsedPct}%`;
  const foot = widget.addText(`${pct} del budget · ${Number(finance.transactionsThisMonth || 0)} movimenti`);
  foot.font = Font.systemFont(10);
  foot.textColor = Color.dynamic(new Color(COLORS.inkSoft), new Color('#AAAAAA'));
}

function addMetric(stack, labelText, valueText) {
  const label = stack.addText(labelText);
  label.font = Font.systemFont(10);
  label.textColor = Color.dynamic(new Color(COLORS.inkSoft), new Color('#999999'));

  const value = stack.addText(valueText);
  value.font = Font.boldSystemFont(21);
  value.minimumScaleFactor = 0.65;
  value.textColor = Color.dynamic(new Color(COLORS.ink), Color.white());
}

function addEmpty(widget, text) {
  const t = widget.addText(text);
  t.font = Font.systemFont(11);
  t.textColor = Color.dynamic(new Color(COLORS.inkFaint), new Color('#888888'));
}

function formatEuro(value) {
  return Number(value || 0).toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  });
}

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
