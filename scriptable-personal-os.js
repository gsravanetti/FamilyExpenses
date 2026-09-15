// PERSONAL OS — Scriptable multi-widget
// Add the same script 3 times to the iOS Home Screen and set Widget Parameter to:
// todo | reminder | finance

const CONFIG = {
  apiUrl: 'https://family-expenses.gs-ravanetti.workers.dev/api/widget',
  baseUrl: 'https://family-expenses.gs-ravanetti.workers.dev/',
  financeUrl: 'https://family-expenses.gs-ravanetti.workers.dev/finance.html',
  tokenKey: 'personal_os_widget_token_v1',
  cacheFile: 'personal-os-widget-cache.json',
  requestedRefreshMinutes: 30
};

const mode = String(args.widgetParameter || 'todo').toLowerCase();
const token = await getToken();
const payload = await loadData(token);
const widget = buildWidget(mode, payload.data, payload.source);

const nextRefresh = new Date();
nextRefresh.setMinutes(nextRefresh.getMinutes() + CONFIG.requestedRefreshMinutes);
widget.refreshAfterDate = nextRefresh;
Script.setWidget(widget);

if (!config.runsInWidget) {
  if (mode === 'finance') await widget.presentMedium();
  else await widget.presentMedium();
}

Script.complete();

async function getToken() {
  if (Keychain.contains(CONFIG.tokenKey)) return Keychain.get(CONFIG.tokenKey);
  if (config.runsInWidget) return null;

  const alert = new Alert();
  alert.title = 'Personal OS';
  alert.message = 'Inserisci il token del widget. Verrà salvato nel Keychain di iOS.';
  alert.addSecureTextField('Widget token', '');
  alert.addAction('Salva');
  alert.addCancelAction('Più tardi');
  const action = await alert.presentAlert();
  if (action === -1) return null;
  const value = alert.textFieldValue(0).trim();
  if (!value) return null;
  Keychain.set(CONFIG.tokenKey, value);
  return value;
}

async function loadData(token) {
  if (!token) return { data: demoData(), source: 'demo' };
  try {
    const req = new Request(CONFIG.apiUrl);
    req.method = 'GET';
    req.timeoutInterval = 12;
    req.headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    };
    const data = await req.loadJSON();
    if (!data || typeof data !== 'object') throw new Error('Risposta API non valida');
    saveCache(data);
    return { data, source: 'live' };
  } catch (error) {
    console.log('Widget API error: ' + error);
    const cached = loadCache();
    if (cached) return { data: cached, source: 'cache' };
    return { data: demoData(), source: 'demo' };
  }
}

function buildWidget(mode, data, source) {
  const widget = new ListWidget();
  widget.setPadding(15, 15, 13, 15);
  widget.backgroundColor = Color.dynamic(new Color('#F5F5F7'), new Color('#171717'));

  addHeader(widget, mode, source);
  widget.addSpacer(10);

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

  widget.addSpacer();
  addUpdated(widget, data.updatedAt);
  return widget;
}

function addHeader(widget, mode, source) {
  const row = widget.addStack();
  const title = row.addText(
    mode === 'finance' ? 'FINANCE' : mode === 'reminder' ? 'REMINDER' : 'TO DO'
  );
  title.font = Font.semiboldSystemFont(12);
  title.textColor = Color.dynamic(new Color('#555555'), new Color('#BBBBBB'));
  row.addSpacer();
  const status = row.addText(source === 'live' ? 'LIVE' : source === 'cache' ? 'CACHE' : 'DEMO');
  status.font = Font.boldSystemFont(8);
  status.textColor = Color.dynamic(new Color('#888888'), new Color('#888888'));
}

function buildTodo(widget, todo) {
  const count = Number(todo.count || 0);
  addCount(widget, count, count === 1 ? 'attività aperta' : 'attività aperte');
  widget.addSpacer(8);
  const items = Array.isArray(todo.items) ? todo.items.slice(0, 4) : [];
  if (!items.length) return addEmpty(widget, 'Nessun To do aperto');
  items.forEach(item => addListRow(widget, item.title, item.note || formatCreated(item.createdAt), '✓'));
}

function buildReminder(widget, reminder) {
  const count = Number(reminder.count || 0);
  addCount(widget, count, count === 1 ? 'promemoria' : 'promemoria');
  widget.addSpacer(8);
  const items = Array.isArray(reminder.items) ? reminder.items.slice(0, 4) : [];
  if (!items.length) return addEmpty(widget, 'Nessun reminder aperto');
  items.forEach(item => addListRow(widget, item.title, formatReminder(item), '◷'));
}

function buildFinance(widget, finance) {
  const label = widget.addText(finance.periodLabel || 'Questo mese');
  label.font = Font.systemFont(10);
  label.textColor = Color.dynamic(new Color('#777777'), new Color('#999999'));
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
  foot.textColor = Color.dynamic(new Color('#666666'), new Color('#AAAAAA'));
}

function addMetric(stack, labelText, valueText) {
  const label = stack.addText(labelText);
  label.font = Font.systemFont(10);
  label.textColor = Color.dynamic(new Color('#777777'), new Color('#999999'));
  const value = stack.addText(valueText);
  value.font = Font.boldSystemFont(21);
  value.minimumScaleFactor = 0.65;
  value.textColor = Color.dynamic(Color.black(), Color.white());
}

function addCount(widget, count, label) {
  const row = widget.addStack();
  row.centerAlignContent();
  const n = row.addText(String(count));
  n.font = Font.boldSystemFont(28);
  n.textColor = Color.dynamic(Color.black(), Color.white());
  row.addSpacer(7);
  const t = row.addText(label);
  t.font = Font.systemFont(11);
  t.textColor = Color.dynamic(new Color('#777777'), new Color('#AAAAAA'));
}

function addListRow(widget, titleText, subtitleText, glyph) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const icon = row.addText(glyph);
  icon.font = Font.semiboldSystemFont(11);
  icon.textColor = Color.dynamic(new Color('#777777'), new Color('#999999'));
  row.addSpacer(7);

  const text = row.addStack();
  text.layoutVertically();
  const title = text.addText(String(titleText || ''));
  title.font = Font.semiboldSystemFont(11);
  title.lineLimit = 1;
  title.textColor = Color.dynamic(Color.black(), Color.white());

  if (subtitleText) {
    const sub = text.addText(String(subtitleText));
    sub.font = Font.systemFont(9);
    sub.lineLimit = 1;
    sub.textColor = Color.dynamic(new Color('#888888'), new Color('#888888'));
  }
  widget.addSpacer(5);
}

function addEmpty(widget, text) {
  const t = widget.addText(text);
  t.font = Font.systemFont(11);
  t.textColor = Color.dynamic(new Color('#888888'), new Color('#888888'));
}

function addUpdated(widget, value) {
  const t = widget.addText('Aggiornato ' + formatUpdatedAt(value));
  t.font = Font.systemFont(8);
  t.textColor = Color.dynamic(new Color('#AAAAAA'), new Color('#777777'));
}

function formatReminder(item) {
  if (!item.start) return item.note || '';
  const d = new Date(item.start);
  if (isNaN(d.getTime())) return item.note || '';
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (item.allDay) {
    return sameDay ? 'Oggi' : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
  }
  return sameDay
    ? 'Oggi · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }) + ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function formatCreated(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return 'Creato ' + d.toLocaleDateString('it-IT');
}

function formatEuro(value) {
  const n = Number(value || 0);
  return n.toLocaleString('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0
  });
}

function formatUpdatedAt(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
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

function demoData() {
  return {
    todo: {
      count: 3,
      items: [
        { title: 'Inviare documenti alla banca', note: 'Demo' },
        { title: 'Prenotare manutenzione', note: 'Demo' },
        { title: 'Controllare assicurazione', note: 'Demo' }
      ]
    },
    reminder: {
      count: 2,
      items: [
        { title: 'Dentista', start: new Date(Date.now() + 2 * 3600000).toISOString(), allDay: false },
        { title: 'Scadenza documento', start: new Date(Date.now() + 3 * 86400000).toISOString(), allDay: true }
      ]
    },
    finance: {
      periodLabel: new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }),
      monthExpenses: 1842,
      budgetRemaining: 658,
      budgetUsedPct: 73.7,
      transactionsThisMonth: 28
    },
    updatedAt: new Date().toISOString()
  };
}
