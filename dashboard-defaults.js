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
        element.append(
          '<style id="personal-os-mobile-reminder-time">' +
          '@media(max-width:460px){' +
          '#remList .reminder-item .when,#hiddenRemList .reminder-item .when{' +
          'max-width:none!important;overflow:visible!important;text-overflow:clip!important;flex-shrink:0!important' +
          '}' +
          '}' +
          '</style>' +
          '<script src="/dashboard-default-hidden.js"></script>',
          { html: true }
        );
      }
    })
    .transform(response);
}
