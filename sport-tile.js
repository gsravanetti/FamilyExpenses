export function injectSportTile(response) {
  if (!response || !response.ok) return response;
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  if (typeof HTMLRewriter === 'undefined') return response;

  const icon = (paths) => `<span class="sport-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${paths}</svg></span>`;

  const icons = {
    swim: icon('<path d="M2 17c1.6 0 1.6-1 3.2-1s1.6 1 3.2 1 1.6-1 3.2-1 1.6 1 3.2 1 1.6-1 3.2-1 1.6 1 3.2 1"/><path d="M4 20c1.6 0 1.6-1 3.2-1s1.6 1 3.2 1 1.6-1 3.2-1 1.6 1 3.2 1 1.6-1 3.2-1"/><circle cx="8" cy="7" r="2"/><path d="m10 10 3 2 2-3 3 2"/><path d="m6 13 4-3"/>'),
    run: icon('<circle cx="14" cy="5" r="2"/><path d="m12 8-2 4 3 2 2 4"/><path d="m12 9 4 2 2-1"/><path d="m10 12-3 3-3 1"/><path d="m13 14-3 5"/>'),
    bike: icon('<circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><path d="m8 17 4-7 3 7"/><path d="M10 10h4"/><path d="m12 10-2-3"/><path d="m14 7 3 1"/><path d="M12 17H8"/>'),
    gym: icon('<path d="M6 8v8"/><path d="M18 8v8"/><path d="M3 10v4"/><path d="M21 10v4"/><path d="M6 12h12"/>'),
    surf: icon('<path d="M2 17c2.2-5 5.5-7.5 9.5-7.5 4.8 0 7.7 3.2 10.5 7.5-3.4-2.2-6.3-2.8-8.9-1.8-2.8 1.1-5.1 3.5-7.7 3.5-1.3 0-2.4-.5-3.4-1.7Z"/><path d="M13 7c1.8-1.5 3.8-2.1 6-1.8-1 1.8-2.2 3.2-3.8 4.1"/>'),
    other: icon('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>')
  };

  const styles = `
<style id="sportTileStyles">
.sport-tile,.sport-tile button{font-family:var(--sans);letter-spacing:normal}
.sport-tile{margin-top:14px;background:var(--surface);border:1px solid var(--line);border-radius:22px;overflow:hidden;box-shadow:0 4px 16px rgba(31,41,55,.025);color:var(--ink)}
.sport-head{display:flex;align-items:center;gap:12px;padding:16px 17px 13px;border-bottom:1px solid var(--line)}
.sport-head-copy{min-width:0;margin-right:auto}.sport-head-copy h2{margin:0;font-size:1rem;font-weight:800;line-height:1.2}.sport-head-copy p{margin:3px 0 0;font-size:.7rem;font-weight:400;color:var(--ink-faint);line-height:1.35}
.sport-toggle{display:inline-flex;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:2px;gap:2px;flex:0 0 auto}
.sport-toggle button{border:0;background:transparent;color:var(--ink-soft);min-width:44px;height:32px;border-radius:9px;padding:0 9px;font-size:.71rem;font-weight:800;transition:background .15s,color .15s,box-shadow .15s}
.sport-toggle button.is-active{background:var(--surface);color:var(--blue);box-shadow:0 1px 4px rgba(15,23,42,.10)}
.sport-toggle button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.sport-grid{display:grid;grid-template-columns:minmax(116px,1.45fr) repeat(3,minmax(61px,1fr));align-items:center;padding:8px 12px 10px}
.sport-grid>div{min-width:0;padding:9px 4px;border-top:1px solid var(--line);font-size:.72rem}
.sport-grid>.sport-colhead{border-top:0;padding-top:3px;padding-bottom:7px;color:var(--ink-faint);font-size:.69rem;font-weight:800;text-align:center}
.sport-grid>.sport-colhead:first-child{text-align:left}
.sport-name{display:flex;align-items:center;gap:9px;font-size:.84rem!important;font-weight:780;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sport-name-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.sport-icon{width:27px;height:27px;border-radius:9px;background:var(--surface-2);border:1px solid var(--line);display:grid;place-items:center;flex:0 0 27px;color:var(--ink-soft)}
.sport-icon svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.sport-value{text-align:center;font-variant-numeric:tabular-nums;font-size:.72rem!important;font-weight:750;color:var(--ink-soft);white-space:nowrap}
.sport-value.is-pending{color:var(--ink-faint);font-weight:700}
.sport-foot{padding:0 16px 13px;color:var(--ink-faint);font-size:.69rem;line-height:1.45}
.sport-tile[data-mode="fy"] .sport-toggle button[data-sport-mode="fy"],.sport-tile[data-mode="ytd"] .sport-toggle button[data-sport-mode="ytd"]{background:var(--surface);color:var(--blue)}
@media(max-width:430px){.sport-head{padding:14px 12px 12px}.sport-grid{padding-left:8px;padding-right:8px;grid-template-columns:minmax(105px,1.4fr) repeat(3,minmax(55px,1fr))}.sport-grid>div{padding-left:2px;padding-right:2px}.sport-name{gap:7px;font-size:.79rem!important}.sport-icon{width:24px;height:24px;flex-basis:24px}.sport-icon svg{width:14px;height:14px}.sport-value{font-size:.68rem!important}.sport-toggle button{min-width:41px;padding:0 7px}}
</style>`;

  const cell = (row, year) => `<div class="sport-value is-pending" data-sport-cell data-sport-row="${row}" data-year="${year}" data-ytd="—" data-fy="—">—</div>`;
  const sportRow = (row, label, sportIcon) => `
    <div class="sport-name" role="rowheader">${sportIcon}<span class="sport-name-label">${label}</span></div>${cell(row, 2026)}${cell(row, 2025)}${cell(row, 2024)}`;

  const tile = `
<section class="sport-tile" id="sportTile" data-mode="ytd" aria-labelledby="sportTitle">
  <div class="sport-head">
    <div class="sport-head-copy">
      <h2 id="sportTitle">Sport</h2>
      <p id="sportModeHelp" aria-live="polite">YTD · confronto allo stesso giorno dell'anno</p>
    </div>
    <div class="sport-toggle" role="group" aria-label="Periodo di confronto sportivo">
      <button type="button" data-sport-mode="ytd" class="is-active" aria-pressed="true">YTD</button>
      <button type="button" data-sport-mode="fy" aria-pressed="false">FY</button>
    </div>
  </div>
  <div class="sport-grid" role="table" aria-label="Riepilogo attività sportive">
    <div class="sport-colhead" role="columnheader">Attività</div>
    <div class="sport-colhead" role="columnheader">2026</div>
    <div class="sport-colhead" role="columnheader">2025</div>
    <div class="sport-colhead" role="columnheader">2024</div>
${sportRow('swim', 'Nuoto', icons.swim)}
${sportRow('run', 'Corsa', icons.run)}
${sportRow('bike', 'Ciclismo', icons.bike)}
${sportRow('gym', 'Palestra', icons.gym)}
${sportRow('surf', 'Surf', icons.surf)}
${sportRow('other', 'Altre attività', icons.other)}
  </div>
  <div class="sport-foot" id="sportModeFoot">Nuoto, corsa e ciclismo: n. attività · km. Palestra, surf e altre attività: n. attività · h.</div>
</section>`;

  return new HTMLRewriter()
    .on('head', {
      element(element) {
        element.append(styles, { html: true });
        element.append('<script src="/sport-tile-client-v2.js" defer></script>', { html: true });
      }
    })
    .on('section.grid', { element(element) { element.after(tile, { html: true }); } })
    .transform(response);
}
