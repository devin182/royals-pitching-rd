// Shared helpers: nav, data loading, Plotly theme, formatting.
const PAL = {FF:'#E8EEF4',SI:'#7AB2DD',FC:'#4f86c6',SL:'#C9A227',ST:'#f08a3c',SV:'#d77b5b',CU:'#b38ce0',KC:'#8e6bd1',CH:'#6fd3a0',FS:'#3fb489',FO:'#2f8f6e',KN:'#999'};
const NAMES = {FF:'4-Seam',SI:'Sinker',FC:'Cutter',SL:'Slider',ST:'Sweeper',SV:'Slurve',CU:'Curveball',KC:'Knuckle Curve',CH:'Changeup',FS:'Splitter',FO:'Forkball',KN:'Knuckleball'};
const LAYOUT = (o={}) => Object.assign({
  paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
  font:{family:'IBM Plex Sans, sans-serif', color:'#C5DCEF', size:12},
  margin:{l:56,r:16,t:40,b:84}, hoverlabel:{bgcolor:'#071428',bordercolor:'#7AB2DD',font:{family:'JetBrains Mono',size:12}},
  legend:{orientation:'h', y:-0.3, font:{size:11}},
  xaxis:{gridcolor:'#1f3d66', zerolinecolor:'#33557f', linecolor:'#33557f'},
  yaxis:{gridcolor:'#1f3d66', zerolinecolor:'#33557f', linecolor:'#33557f'}
}, o);
const CFG = {displayModeBar:false, responsive:true};
const fmt = (x,d=1) => x==null||isNaN(x) ? '–' : Number(x).toFixed(d);
const pct = (x,d=0) => x==null||isNaN(x) ? '–' : (100*x).toFixed(d)+'%';
const sgn = (x,d=1) => x==null||isNaN(x) ? '–' : (x>0?'+':'')+Number(x).toFixed(d);
const nice = n => n.replace(/^(.*), (.*)$/,'$2 $1');
const getJSON = f => fetch(f).then(r => r.json());
function stuffColor(s){ if(s==null) return '#5b6b7f'; const t=Math.max(-1,Math.min(1,(s-100)/15));
  return t>=0 ? `rgb(${Math.round(232-110*t)},${Math.round(238-20*t)},${Math.round(244-80*t)})` : `rgb(${Math.round(232+20*-t)},${Math.round(238-110*-t)},${Math.round(244-120*-t)})`; }
document.addEventListener('DOMContentLoaded', () => {
  const b=document.querySelector('.burger'), u=document.querySelector('.nav ul');
  if(b) b.addEventListener('click',()=>u.classList.toggle('open'));
  const here=location.pathname.split('/').pop()||'index.html';
  document.querySelectorAll('.nav li a').forEach(a=>{ if(a.getAttribute('href')===here) a.classList.add('on'); });
  getJSON('data/meta.json').then(m=>{ const x=m.meta[0]||m.meta;
    document.querySelectorAll('[data-meta]').forEach(el=>{ const k=el.dataset.meta; let v=x[k];
      if(typeof v==='number') v=v.toLocaleString(); el.textContent=v; }); }).catch(()=>{});
});
