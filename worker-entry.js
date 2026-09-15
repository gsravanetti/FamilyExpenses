import appWorker from './worker.js';
import { handleWidget } from './widget.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/widget') {
      try {
        return await handleWidget(request, env);
      } catch (error) {
        console.error('Widget API error', error);
        return new Response(JSON.stringify({
          error: error instanceof Error ? error.message : 'Errore interno widget.'
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
          }
        });
      }
    }
    return appWorker.fetch(request, env, ctx);
  }
};
