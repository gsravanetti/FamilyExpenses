(function(){
  'use strict';

  function initSportTile(){
    var tile=document.getElementById('sportTile');
    if(!tile||tile.getAttribute('data-sport-ready')==='true')return;

    var buttons=tile.querySelectorAll('[data-sport-mode]');
    var help=document.getElementById('sportModeHelp');
    var cells=tile.querySelectorAll('[data-sport-cell]');
    var key='personalOS.sportMode';

    function apply(mode){
      mode=mode==='fy'?'fy':'ytd';
      tile.setAttribute('data-mode',mode);

      Array.prototype.forEach.call(buttons,function(button){
        var active=button.getAttribute('data-sport-mode')===mode;
        button.classList.toggle('is-active',active);
        button.setAttribute('aria-pressed',active?'true':'false');
      });

      Array.prototype.forEach.call(cells,function(cell){
        var value=cell.getAttribute('data-'+mode);
        cell.textContent=value||'—';
        cell.classList.toggle('is-pending',!value||value==='—');
      });

      if(help){
        help.textContent=mode==='fy'
          ? 'FY · 2026 YTD, anni chiusi a fine anno'
          : 'YTD · confronto allo stesso giorno dell\'anno';
      }

      try{localStorage.setItem(key,mode);}catch(e){}

      tile.dispatchEvent(new CustomEvent('sportmodechange',{detail:{mode:mode}}));
    }

    Array.prototype.forEach.call(buttons,function(button){
      button.addEventListener('click',function(){
        apply(button.getAttribute('data-sport-mode'));
      });
    });

    var initial='ytd';
    try{initial=localStorage.getItem(key)||'ytd';}catch(e){}
    tile.setAttribute('data-sport-ready','true');
    apply(initial);

    window.personalOSSportTile={
      apply:apply,
      setData:function(payload){
        if(!payload||!payload.sports)return;
        Array.prototype.forEach.call(cells,function(cell){
          var row=cell.getAttribute('data-sport-row');
          var year=cell.getAttribute('data-year');
          var sport=payload.sports[row];
          if(!sport||!sport[year])return;
          var values=sport[year];
          if(Object.prototype.hasOwnProperty.call(values,'ytd'))cell.setAttribute('data-ytd',values.ytd);
          if(Object.prototype.hasOwnProperty.call(values,'fy'))cell.setAttribute('data-fy',values.fy);
        });
        apply(tile.getAttribute('data-mode')||'ytd');
      }
    };
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initSportTile,{once:true});
  else initSportTile();
})();
