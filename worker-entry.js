import appWorker, { withSecurityHeaders } from './worker.js';
import {
  handleUnifiedWidget,
  handleWidgetCredential
} from './widget-user.js';
import {
  handleFinanceProxy,
  injectFinanceSessionBridge,
  isFinancePath
} from './finance-auth.js';
import {
  injectDashboardDefaults,
  isDashboardPath
} from './dashboard-defaults.js';
import { handleTodoCompletedApi } from './todo-completed-api.js';
import { injectPwaIcons } from './pwa-icons.js';
import { injectSportTile } from './sport-tile.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return appWorker.fetch(request, env, ctx);

    if (url.pathname === '/api/widget/credential') {
      try {
        return withSecurityHeaders(await handleWidgetCredential(request, env));
      } catch (error) {
        console.error('Widget credential error', error);
        return withSecurityHeaders(new Response(JSON.stringify({ error: 'Errore creazione credenziale widget.' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-store'
          }
        }));
      }
    }

    if (url.pathname === '/api/widget') {
      try {
        return withSecurityHeaders(await handleUnifiedWidget(request, env));
      } catch (error) {
        console.error('Widget API error', error);
        return withSecurityHeaders(new Response(JSON.stringify({ error: 'Errore interno widget.' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          }
        }));
      }
    }

    if (url.pathname === '/api/finance') {
      try {
        return withSecurityHeaders(await handleFinanceProxy(request, env));
      } catch (error) {
        console.error('Finance API error', error);
        return withSecurityHeaders(new Response(JSON.stringify({ error: 'Errore interno Finance.' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-store'
          }
        }));
      }
    }

    if (url.pathname === '/api/todo-completed') {
      try {
        return withSecurityHeaders(await handleTodoCompletedApi(request, env));
      } catch (error) {
        console.error('Completed ToDo API error', error);
        return withSecurityHeaders(new Response(JSON.stringify({ error: 'Errore interno Completed.' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'private, no-store'
          }
        }));
      }
    }

    let response = await appWorker.fetch(request, env, ctx);
    if (isFinancePath(url.pathname)) response = injectFinanceSessionBridge(response);
    if (isDashboardPath(url.pathname)) {
      response = injectDashboardDefaults(response);
      response = injectSportTile(response);
    }
    return injectPwaIcons(response, url.pathname);
  }
};
