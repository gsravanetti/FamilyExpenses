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
          '<style id="personal-os-dashboard-polish">' +
          '.action-grid{grid-template-columns:repeat(4,1fr)!important}' +
          '#todoList .item-sub{display:none!important}' +
          '#todoList .item{min-height:50px!important;padding-top:7px!important;padding-bottom:7px!important}' +
          '#todoList .item-main{display:flex;align-items:center;min-height:32px}' +
          '#completedTodoList .completed-item{grid-template-columns:31px minmax(0,1fr);min-height:58px}' +
          '#completedTodoList .completed-check{width:25px;height:25px;border-radius:9px;background:var(--green-soft);color:var(--green);display:grid;place-items:center;font-weight:950}' +
          '#completedTodoList .item-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '@media(max-width:460px){' +
          '.action-grid{gap:5px!important}' +
          '.action-btn{min-width:0!important;padding-left:3px!important;padding-right:3px!important;font-size:.64rem!important}' +
          '#remList .reminder-item .when,#hiddenRemList .reminder-item .when{' +
          'max-width:none!important;overflow:visible!important;text-overflow:clip!important;flex-shrink:0!important' +
          '}' +
          '}' +
          '</style>' +
          '<script src="/dashboard-default-hidden.js"></script>' +
          '<script src="/dashboard-completed.js"></script>',
          { html: true }
        );
      }
    })
    .transform(response);
}
