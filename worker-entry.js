import appWorker, { withSecurityHeaders } from './worker.js';
import { handleWidget } from './widget.js';

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
    return appWorker.fetch(request, env, ctx);
  }
};
