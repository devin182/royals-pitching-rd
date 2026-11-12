// Shared helpers: nav, data loading, Plotly theme, formatting.
const PAL = new Proxy(window.PITCH_COLORS || {}, {get:(o,k)=> o[k] || '#9AA3B5'});   // config/pitch_colors.json, shared with the R Markdown cards
const NAMES = {FF:'4-Seam',SI:'Sinker',FC:'Cutter',SL:'Slider',ST:'Sweeper',SV:'Slurve',CU:'Curveball',KC:'Knuckle Curve',CH:'Changeup',FS:'Splitter',FO:'Forkball',KN:'Knuckleball'};
const LAYOUT_BASE = (o={}) => Object.assign({
  paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
  font:{family:'IBM Plex Sans, sans-serif', color:'#C5DCEF', size:12},
  showlegend:false,
  margin:{l:56,r:16,t:40,b:84}, hoverlabel:{bgcolor:'#071428',bordercolor:'#7AB2DD',font:{family:'JetBrains Mono',size:12}},
  legend:{orientation:'h', y:-0.3, font:{size:11}},
  xaxis:{gridcolor:'#1f3d66', zerolinecolor:'#33557f', linecolor:'#33557f'},
  yaxis:{gridcolor:'#1f3d66', zerolinecolor:'#33557f', linecolor:'#33557f'}
}, o);
// deep-merge axes so per-chart axis options keep the shared grid styling
const LAYOUT = (o={}) => { const b = LAYOUT_BASE({}); const r = LAYOUT_BASE(o);
  ['xaxis','yaxis'].forEach(k => { r[k] = Object.assign({}, b[k], o[k]||{}); });
  const tickFont = {family:'IBM Plex Sans, Helvetica Neue, Arial, sans-serif', size:11, color:MUTED};
  r.xaxis.tickfont = r.xaxis.tickfont || tickFont; r.yaxis.tickfont = r.yaxis.tickfont || tickFont;
  if ((r.annotations||[]).some(a => a._callout)) {        // make room for the callout slot under the title
    r.margin = Object.assign({}, r.margin); r.margin.t = (r.margin.t||40) + 26;
    r.annotations = r.annotations.map(a => { const c = Object.assign({}, a); delete c._callout; return c; });
    if (r.title && r.title.text) r.title = Object.assign({y:0.985, yanchor:'top'}, r.title);
  }
  return r; };
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

// ---- chart-polish helpers -------------------------------------------------
const GOLD = '#C9A227';
// Wilson 95% interval for k successes in n trials
function wilson(k, n, z = 1.96){ if(!n) return [null,null]; const p=k/n, d=1+z*z/n, c=p+z*z/(2*n), m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)); return [(c-m)/d,(c+m)/d]; }
// Fisher-z 95% interval for a correlation
function corrCI(r, n){ const z=Math.atanh(r), se=1/Math.sqrt(n-3); return [Math.tanh(z-1.96*se), Math.tanh(z+1.96*se)]; }
// error_y spec from rates + denominators (Wilson)
function wilsonErr(p, n){ const lo=[], hi=[]; p.forEach((v,i)=>{ const k=Math.round(v*n[i]); const [a,b]=wilson(k,n[i]); lo.push(v-a); hi.push(b-v); });
  return {type:'data', symmetric:false, array:hi, arrayminus:lo, color:'rgba(232,238,244,.7)', thickness:1.4, width:4}; }
// one gold callout per chart (design_v2/chart_style.md): a single sentence in a slot above the plot,
// gold rule + gold text, no leader into the data. x/y are kept for call-site readability only.
function callout(x, y, text){ return {xref:'paper', yref:'paper', x:0, y:1, xanchor:'left', yanchor:'bottom', yshift:6, showarrow:false, align:'left',
  text:'<span style="color:#C9A227">▍</span> '+String(text).replace(/<br>/g,' '), font:{color:'#C9A227', size:12, family:'IBM Plex Sans'}, _callout:true}; }
const MIN_SWINGS = 50, MUTED = '#9AA3B5';   // minimum-n rule: grey a rate below 50 swings
// direct labels at the end of line traces instead of a legend
function endLabels(traces, o = {}){ return traces.filter(t=>t.x && t.x.length).map(t=>({x:t.x[t.x.length-1], y:t.y[t.y.length-1], text:t.name, showarrow:false,
  xanchor:'left', xshift:8, font:{color:(t.line&&t.line.color)||(t.marker&&t.marker.color)||'#E8EEF4', size:o.size||11}})); }
const nFmt = n => Number(n).toLocaleString();
