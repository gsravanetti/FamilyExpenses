export function injectPwaIcons(response, pathname) {
  if (!response || !response.ok) return response;
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  if (typeof HTMLRewriter === 'undefined') return response;

  const finance = pathname === '/finance' || pathname === '/finance/' || pathname === '/finance.html';
  const personal = pathname === '/' || pathname === '/index.html';
  if (!finance && !personal) return response;

  const icon = finance ? '/icons/finance/icon-192-v2.png' : '/icons/personal-os/icon.svg';
  const appleIcon = finance ? '/icons/finance/apple-touch-icon-v2.png' : '/icons/personal-os/icon.svg';
  const manifest = finance ? '/finance-v2.webmanifest' : '/personal-os.webmanifest';
  const title = finance ? 'Finance' : 'Personal OS';

  let rewriter = new HTMLRewriter();

  if (finance) {
    rewriter = rewriter
      .on('link[rel="manifest"]', {
        element(element) {
          element.setAttribute('href', manifest);
        }
      })
      .on('link[rel="icon"]', {
        element(element) {
          element.setAttribute('href', icon);
          element.setAttribute('type', 'image/png');
          element.setAttribute('sizes', '192x192');
        }
      })
      .on('link[rel="apple-touch-icon"]', {
        element(element) {
          element.setAttribute('href', appleIcon);
          element.setAttribute('sizes', '180x180');
        }
      });
  } else {
    rewriter = rewriter.on('head', {
      element(element) {
        element.append(
          `<link rel="manifest" href="${manifest}">` +
          `<link rel="icon" href="${icon}" type="image/svg+xml" sizes="any">` +
          `<link rel="apple-touch-icon" href="${appleIcon}" sizes="192x192">`,
          { html: true }
        );
      }
    });
  }

  return rewriter
    .on('head', {
      element(element) {
        element.append(
          '<meta name="apple-mobile-web-app-capable" content="yes">' +
          '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
          `<meta name="apple-mobile-web-app-title" content="${title}">`,
          { html: true }
        );
      }
    })
    .transform(response);
}
