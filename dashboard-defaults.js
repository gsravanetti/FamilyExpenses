export function isDashboardPath(pathname) {
  return pathname === '/' || pathname === '/index.html';
}

export function injectDashboardDefaults(response) {
  if (!response || !response.ok) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  if (typeof HTMLRewriter !== 'function') return response;

  return new HTMLRewriter()
    .on('body', {
      element(element) {
        element.append('<script src="/dashboard-default-hidden.js"></script>', { html: true });
      }
    })
    .transform(response);
}
