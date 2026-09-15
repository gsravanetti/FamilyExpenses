import appWorker, { withSecurityHeaders } from './worker.js';
import { handleWidget } from './widget.js';
import {
  handleFinanceProxy,
  injectFinanceSessionBridge,
  isFinancePath
} from './finance-auth.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') return appWorker.fetch(request, env, ctx);

    if (url.pathname === '/api/widget') {
      try {
        return withSecurityHeaders(await handleWidget(request, env));
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

    const response = await appWorker.fetch(request, env, ctx);
    return isFinancePath(url.pathname)
      ? injectFinanceSessionBridge(response)
      : response;
  }
};
