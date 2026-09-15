# App icon package

## Personal OS
- Source used by web/PWA: `personal-os/icon.svg`
- Manifest: `/personal-os.webmanifest`
- Routes: `/` and `/index.html`
- Visual: black Liquid Glass field with gold house.

## Finance
- Source used by web/PWA: `finance/icon-192.svg`
- Manifest: `/manifest.webmanifest`
- Routes: `/finance`, `/finance/`, `/finance.html`
- Visual: Rolex-style green Liquid Glass field with warm white dollar sign.

## Runtime wiring
`/pwa-icons.js` applies route-specific favicon, Apple Home Screen metadata and PWA manifest metadata. `worker-entry.js` runs this after the existing Finance session bridge and Personal OS dashboard transformations, so authentication and app logic remain unchanged.

The SVG icon assets preserve the approved Liquid Glass artwork and scale for browser/PWA launchers. The manifests define standalone installation metadata for Android and iPhone/iPad web apps.
