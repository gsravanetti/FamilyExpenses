export function injectSportTile(response) {
  if (!response || !response.ok) return response;
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  if (typeof HTMLRewriter === 'undefined') return response;

  const styles = `
<style id="sportTileStyles">
.sport-tile{margin-top:14px;background:var(--surface);border:1px solid var(--line);border-radius:22px;overflow:hidden;box-shadow:0 4px 16px rgba(31,41,55,.025)}
.sport-head{display:flex;align-items:center;gap:12px;padding:14px 16px 12px;border-bottom:1px solid var(--line)}
.sport-head-copy{min-width:0;margin-right:auto}.sport-head-copy h2{margin:0;font-size:.97rem}.sport-head-copy p{margin:3px 0 0;font-size:.68rem;color:var(--ink-faint);line-height:1.35}
.sport-toggle{display:inline-flex;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:2px;gap:2px;flex:0 0 auto}
.sport-toggle button{border:0;background:transparent;color:var(--ink-soft);min-width:42px;height:30px;border-radius:8px;padding:0 8px;font-size:.68rem;font-weight:850}
.sport-toggle button.is-active{background:var(--surface);color:var(--blue);box-shadow:0 1px 4px rgba(15,23,42,.08)}
.sport-grid{display:grid;grid-template-columns:minmax(86px,1.35fr) repeat(3,minmax(61px,1fr));align-items:center;padding:8px 12px 10px}
.sport-grid>div{min-width:0;padding:8px 4px;border-top:1px solid var(--line);font-size:.72rem}
.sport-grid>.sport-colhead{border-top:0;padding-top:3px;padding-bottom:7px;color:var(--ink-faint);font-size:.64rem;font-weight:850;text-align:center}
.sport-grid>.sport-colhead:first-child{text-align:left}
.sport-name{font-weight:800;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sport-value{text-align:center;font-variant-numeric:tabular-nums;font-weight:760;color:var(--ink-soft);white-space:nowrap}
.sport-value.is-pending{color:var(--ink-faint);font-weight:700}
.sport-foot{padding:0 16px 13px;color:var(--ink-faint);font-size:.62rem;line-height:1.45}
@media(max-width:430px){.sport-head{padding:13px 12px 11px}.sport-grid{padding-left:8px;padding-right:8px;grid-template-columns:minmax(78px,1.25fr) repeat(3,minmax(57px,1fr))}.sport-grid>div{padding-left:2px;padding-right:2px;font-size:.67rem}.sport-toggle button{min-width:39px;padding:0 6px}}
</style>`;

  const tile = `
<section class="sport-tile" id="sportTile" aria-labelledby="sportTitle">
  <div class="sport-head">
    <div class="sport-head-copy">
      <h2 id="sportTitle">Sport</h2>
      <p id="sportModeHelp">Confronto YTD allo stesso giorno dell'anno</p>
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

    <div class="sport-name" role="rowheader">Nuoto</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div>
    <div class="sport-name" role="rowheader">Corsa</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div>
    <div class="sport-name" role="rowheader">Ciclismo</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div>
    <div class="sport-name" role="rowheader">Palestra</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div>
    <div class="sport-name" role="rowheader">Surf</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div>
    <div class="sport-name" role="rowheader">Altre attività</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div><div class="sport-value is-pending">—</div>
  </div>
  <div class="sport-foot">Nuoto, corsa e ciclismo: n. attività · km. Palestra, surf e altre attività: n. attività · h.</div>
</section>`;

  const script = `
<script id="sportTileScript">
(function(){
  var tile=document.getElementById('sportTile');
  if(!tile)return;
  var buttons=tile.querySelectorAll('[data-sport-mode]');
  var help=document.getElementById('sportModeHelp');
  var key='personalOS.sportMode';
  function apply(mode){
    mode=mode==='fy'?'fy':'ytd';
    Array.prototype.forEach.call(buttons,function(button){
      var active=button.getAttribute('data-sport-mode')===mode;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',active?'true':'false');
    });
    if(help)help.textContent=mode==='fy'?'2026 YTD · anni chiusi in Full Year':'Confronto YTD allo stesso giorno dell\'anno';
    try{localStorage.setItem(key,mode);}catch(e){}
  }
  var initial='ytd';
  try{initial=localStorage.getItem(key)||'ytd';}catch(e){}
  apply(initial);
  Array.prototype.forEach.call(buttons,function(button){
    button.addEventListener('click',function(){apply(button.getAttribute('data-sport-mode'));});
  });
})();
</script>`;

  return new HTMLRewriter()
    .on('head', { element(element) { element.append(styles, { html: true }); } })
    .on('section.grid', { element(element) { element.after(tile, { html: true }); } })
    .on('body', { element(element) { element.append(script, { html: true }); } })
    .transform(response);
}
