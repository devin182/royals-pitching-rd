// Research page: every figure below is read from site/data/*.json (built by R/03_analysis.R).
// Conventions: direct labels instead of legends, one gold callout per chart, n and 95% intervals shown.
const $ = id => document.getElementById(id);
const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const find = (arr, f) => arr.find(f) || {};
const last = s => nice(s).split(' ').slice(-1)[0];
const GRID = '#1f3d66';
Promise.all(['stuff','vaa','tunnel','counts','fatigue','cases','explorer_index'].map(n => getJSON(`data/${n}.json`))).then(([S,V,T,C,F,K,E]) => {
  // ---- 1. Stuff+ ----------------------------------------------------------
  const v = S.validation; set('split', v.split_date); set('nval', v.n_pitch_types); set('rwhiff', fmt(v.cor_stuff_whiff,2));
  $('valtbl').innerHTML = '<thead><tr><th>Model</th><th>Train</th><th>Holdout</th><th>Trees</th><th>R²</th><th>cor(RV)</th><th>cor(whiff)</th></tr></thead><tbody>' +
    v.pitch_level.map(m => `<tr><td>${m.group}</td><td>${m.n_train.toLocaleString()}</td><td>${m.n_test.toLocaleString()}</td><td>${m.nrounds}</td><td>${fmt(m.r2_pitch,4)}</td><td>${fmt(m.cor_pitch,3)}</td><td>${fmt(m.cor_whiff,3)}</td></tr>`).join('') + '</tbody>';
  const rs = [v.cor_rv_early_vs_rv_late, v.cor_xrv_early_vs_rv_late, v.cor_stuff_early_vs_rv_late], cis = rs.map(r => corrCI(r, v.n_pitch_types));
  const labs = ['Early-season run value','Early-season expected RV','Early-season Stuff+'];
  Plotly.newPlot('valchart', [{type:'bar', orientation:'h', y:labs, x:rs, marker:{color:['#5b6b7f','#7AB2DD','#E8EEF4']},
    error_x:{type:'data', symmetric:false, array:cis.map((c,i)=>c[1]-rs[i]), arrayminus:cis.map((c,i)=>rs[i]-c[0]), color:'#C5DCEF', thickness:1.4, width:5},
    text:rs.map(x=>'r = '+fmt(x,3)), textposition:'inside', insidetextanchor:'start', textfont:{color:'#071428'}, hoverinfo:'skip'}],
    LAYOUT({title:{text:`Predicting late-season run value · n = ${v.n_pitch_types} pitch types`,font:{size:14}}, margin:{l:170,r:30,t:44,b:46},
      xaxis:{range:[0,0.3],gridcolor:GRID,title:'correlation (95% interval)'},
      annotations:[callout(rs[2], labs[2], `Shape alone out-predicts early results (r ${fmt(rs[2],2)} vs ${fmt(rs[0],2)}).`, {ax:40, ay:55})]}), CFG);
  const L = S.league, roy = L.filter(d=>d.royals), oth = L.filter(d=>!d.royals);
  const top = [...roy].filter(d=>d.n>=300).sort((a,b)=>b.stuff_plus-a.stuff_plus)[0];
  Plotly.newPlot('stuffscatter', [
    {x:oth.map(d=>d.stuff_plus), y:oth.map(d=>d.whiff), mode:'markers', type:'scatter', marker:{color:'rgba(122,178,221,.25)',size:5}, hoverinfo:'skip'},
    {x:roy.map(d=>d.stuff_plus), y:roy.map(d=>d.whiff), mode:'markers', type:'scatter', text:roy.map(d=>`${nice(d.name)} ${d.pitch_type} (n=${d.n})`),
     marker:{color:roy.map(d=>PAL[d.pitch_type]||'#E8EEF4'),size:9,line:{color:'#E8EEF4',width:1}}, hovertemplate:'%{text}<br>Stuff+ %{x} · whiff %{y:.1%}<extra></extra>'}],
    LAYOUT({title:{text:`Stuff+ vs whiff rate · ${nFmt(L.length)} MLB pitch types (Royals colored by pitch)`,font:{size:13}},
      xaxis:{title:'Stuff+',gridcolor:GRID}, yaxis:{title:'Whiff / swing',tickformat:'.0%',gridcolor:GRID},
      annotations:[callout(top.stuff_plus, top.whiff, `${nice(top.name)}'s ${top.pitch_type} is the top Royals grade at ${top.stuff_plus} Stuff+.`, {ax:50, ay:-50}),
        {x:70, y:0.62, text:'grey = rest of MLB', showarrow:false, font:{color:'#9AA3B5',size:11}}]}), CFG);
  const groups = ['Fastball','Breaking','Offspeed'], gc = {Fastball:'#E8EEF4',Breaking:'#7AB2DD',Offspeed:'#43AA8B'};
  const feats = [...new Set(S.importance.map(d=>d.feature))];
  const pretty = {release_speed:'Velocity',ivb:'IVB',hb_arm:'HB (arm side)',release_spin_rate:'Spin rate',spin_axis_arm:'Spin axis',release_extension:'Extension',
    release_pos_z:'Release height',rel_side_arm:'Release side',arm_angle:'Arm angle',velo_diff:'Velo gap vs FB',ivb_diff:'IVB gap vs FB',hb_diff:'HB gap vs FB'};
  const gain = (g,f) => (find(S.importance, d=>d.group===g&&d.feature===f).gain)||0;
  const topOff = feats.map(f=>({f,g:gain('Offspeed',f)})).sort((a,b)=>b.g-a.g)[0];
  Plotly.newPlot('imp', groups.map(g => ({type:'bar', orientation:'h', name:g, marker:{color:gc[g]},
      y:feats.map(f=>pretty[f]||f), x:feats.map(f=>gain(g,f)), hovertemplate:g+' %{y}: %{x:.3f}<extra></extra>'})),
    LAYOUT({barmode:'group', showlegend:true, legend:{orientation:'h', y:-0.16, x:0}, title:{text:'',font:{size:14}}, margin:{l:120,r:10,t:20,b:70}, yaxis:{autorange:'reversed'}, xaxis:{gridcolor:GRID, title:'xgboost gain'},
      annotations:[callout(topOff.g, pretty[topOff.f], `For offspeed pitches, ${pretty[topOff.f].toLowerCase()} carries the most weight.`, {ax:-140, ay:30})]}), CFG);
  const ld = K.stuff_leader, row = d => `<tr><td>${nice(d.player_name)}</td><td><span style="color:${PAL[d.pitch_type]}">●</span> ${d.pitch_type}</td><td>${d.n}</td><td><span class="sp" style="background:${stuffColor(d.stuff_plus)}">${d.stuff_plus}</span></td><td>${sgn(d.xrv100,2)}</td><td>${sgn(d.rv100,2)}</td></tr>`;
  const head = '<thead><tr><th>Pitcher</th><th>Pitch</th><th>#</th><th>Stuff+</th><th>xRV/100</th><th>RV/100</th></tr></thead>';
  $('lead').innerHTML = head + '<tbody>' + ld.slice(0,8).map(row).join('') + '</tbody>';
  $('lag').innerHTML = head + '<tbody>' + ld.slice(-8).reverse().map(row).join('') + '</tbody>';

  // ---- 2. VAA ----------------------------------------------------------------
  set('vaar2', fmt(V.r2,2)); const Q = V.league_quintiles;
  set('q5hi', pct(Q[4].whiff,1)); set('q1hi', pct(Q[0].whiff,1)); set('q1lo', pct(Q[0].low_whiff,1)); set('q5lo', pct(Q[4].low_whiff,1));
  const ql = ['Steepest','Q2','Q3','Q4','Flattest'];
  Plotly.newPlot('vaaq', [
    {type:'bar', x:ql, y:Q.map(q=>q.whiff), marker:{color:'#E8EEF4'}, error_y:wilsonErr(Q.map(q=>q.whiff), Q.map(q=>q.swings)),
     text:Q.map(q=>pct(q.whiff)), textposition:'inside', textfont:{color:'#071428'}, customdata:Q.map(q=>q.swings), hovertemplate:'top third %{y:.1%} (%{customdata} swings)<extra></extra>'},
    {type:'bar', x:ql, y:Q.map(q=>q.low_whiff), marker:{color:'#7AB2DD'}, error_y:wilsonErr(Q.map(q=>q.low_whiff), Q.map(q=>q.low_swings)),
     text:Q.map(q=>pct(q.low_whiff)), textposition:'inside', customdata:Q.map(q=>q.low_swings), hovertemplate:'bottom third %{y:.1%} (%{customdata} swings)<extra></extra>'}],
    LAYOUT({title:{text:'MLB four-seam whiff/swing by location-adjusted VAA quintile',font:{size:13}}, yaxis:{tickformat:'.0%',range:[0,.48],gridcolor:GRID},
      annotations:[{x:'Steepest', y:Q[0].whiff+0.075, xshift:-17, text:'top<br>third', showarrow:false, font:{size:10,color:'#E8EEF4'}},
                   {x:'Steepest', y:Q[0].low_whiff+0.07, xshift:17, text:'bottom<br>third', showarrow:false, font:{size:10,color:'#7AB2DD'}},
                   callout('Flattest', Q[4].whiff, `Up in the zone, the flattest fifth gets ${pct(Q[4].whiff)} whiffs vs ${pct(Q[0].whiff)} for the steepest.`, {ax:-90, ay:-28})]}), CFG);
  const vr = V.pitchers.filter(p=>p.is_royals); const cz0 = find(vr, p=>p.player_name==='Cruz, Steven');
  Plotly.newPlot('vaaroy', [{x:vr.map(p=>p.vaa_adj), y:vr.map(p=>p.high_whiff), mode:'markers+text', type:'scatter', text:vr.map(p=>last(p.player_name)),
    textposition:'middle right', textfont:{color:'#C5DCEF',size:11}, customdata:vr.map(p=>[p.n, p.vaa, p.high_share, p.high_sw]),
    error_y:wilsonErr(vr.map(p=>p.high_whiff), vr.map(p=>p.high_sw)),
    marker:{size:vr.map(p=>Math.sqrt(p.n)*0.9), color:vr.map(p=>p.high_sw>=MIN_SWINGS?PAL.FF:MUTED), opacity:.9, line:{color:'#071428',width:1}},
    hovertemplate:'%{text}<br>VAA adj %{x:+.2f}° (raw %{customdata[1]:.1f}°)<br>high-zone whiff %{y:.0%} on %{customdata[3]} swings<br>%{customdata[0]} FF, %{customdata[2]:.0%} up<extra></extra>'}],
    LAYOUT({title:{text:'Royals four-seamers (200+): flatness vs high-zone whiffs · bars = 95% intervals',font:{size:13}}, xaxis:{title:'Location-adjusted VAA (°, + = flatter)',gridcolor:GRID,zerolinecolor:'#7AB2DD'},
      yaxis:{title:'Whiff / swing, top third',tickformat:'.0%',gridcolor:GRID},
      annotations:[callout(cz0.vaa_adj, cz0.high_whiff, `Cruz is flat (${sgn(cz0.vaa_adj,2)}°) and gets ${pct(cz0.high_whiff)} whiffs up, but throws only ${pct(cz0.high_share)} of his four-seamers there.`, {ax:-150, ay:-30})]}), CFG);

  // ---- 3. Cameron slider -------------------------------------------------------
  const cam = E.find(p=>p.name==='Cameron, Noah'); const cid = cam.id;
  const R = K.regions.filter(r=>r.pitcher===cid && r.pitch_type==='SL'); const reg = ['Chase-Above','Zone-High','Zone-Middle','Zone-Low','Chase-Below','Chase-Side'];
  const rr = reg.map(g=>find(R, r=>r.region===g)); const cb = find(R,r=>r.region==='Chase-Below'), cm = find(R,r=>r.region==='Zone-Middle');
  set('cambelow', pct(cb.whiff)); set('cammid', pct(cm.whiff));
  const H = K.halves.filter(h=>h.pitcher===cid && h.pitch_type==='SL'); const h1 = find(H,h=>!h.second_half), h2 = find(H,h=>h.second_half);
  set('cam1b', pct(h1.below_share)); set('cam2b', pct(h2.below_share));
  Plotly.newPlot('camreg', [
    {type:'bar', x:reg, y:rr.map(r=>r.whiff), marker:{color:PAL.SL}, error_y:wilsonErr(rr.map(r=>r.whiff||0), rr.map(r=>r.swings||0)), text:rr.map(r=>'n='+r.n), textposition:'outside', textfont:{size:10}, cliponaxis:false},
    {type:'scatter', mode:'markers', x:reg, y:rr.map(r=>r.xrv100), yaxis:'y2', marker:{symbol:'diamond',size:12,color:'#E8EEF4',line:{color:'#071428',width:1}}, hovertemplate:'xRV/100 %{y:.2f}<extra></extra>'}],
    LAYOUT({title:{text:'Noah Cameron · slider by region (bars = whiff/swing, ◆ = xRV/100)',font:{size:13}}, yaxis:{tickformat:'.0%',range:[0,.95],gridcolor:GRID,title:'whiff / swing'},
      yaxis2:{overlaying:'y',side:'right',title:'xRV / 100',zeroline:true,zerolinecolor:'#9AA3B5',showgrid:false}, margin:{l:56,r:56,t:44,b:70},
      annotations:[callout('Chase-Below', cb.whiff, `Below the zone the slider gets ${pct(cb.whiff)} whiffs per swing.`, {ax:-110, ay:-12})]}), CFG);
  // before / after heatmaps
  const G = K.cameron_sl_grid; const xs=[], zs=[]; for(let x=-1.875;x<=1.88;x+=.25) xs.push(+x.toFixed(3)); for(let z=-0.6875;z<=1.69;z+=.125) zs.push(+z.toFixed(4));
  const grid = half => { const N = zs.map(()=>xs.map(()=>0)); let tot=0;
    G.filter(g=>g.second_half===half).forEach(g=>{ const i=zs.findIndex(z=>Math.abs(z-g.z_bin)<1e-3), j=xs.findIndex(x=>Math.abs(x-g.x_bin)<1e-3); if(i>=0&&j>=0){N[i][j]+=g.n; tot+=g.n;} });
    const Z = N.map((r,i)=>r.map((_,j)=>{let s=0,c=0;for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const v=N[i+a]?.[j+b];if(v!=null){const w=(a==0&&b==0)?2:1;s+=v*w;c+=w;}}return s/c/tot;}));
    return {Z, tot}; };
  const g1 = grid(false), g2 = grid(true); const zmax = Math.max(...g1.Z.flat(), ...g2.Z.flat());
  const heatLayout = (title, h, note) => LAYOUT({title:{text:title,font:{size:13}}, margin:{l:50,r:10,t:44,b:46},
    xaxis:{range:[-2,2],title:'Plate side (ft)',gridcolor:'rgba(0,0,0,0)',zeroline:false}, yaxis:{range:[-0.75,1.75],title:'Height in zone',gridcolor:'rgba(0,0,0,0)',zeroline:false},
    shapes:[{type:'rect',x0:-0.83,x1:0.83,y0:0,y1:1,line:{color:'#E8EEF4',width:2}},{type:'line',x0:-2,x1:2,y0:0,y1:0,line:{color:'rgba(232,238,244,.35)',dash:'dot',width:1}}],
    annotations: note ? [callout(0.95,-0.5,note,{ax:0,ay:0,extra:{showarrow:false}})] : []});
  const cs = [[0,'rgba(11,31,58,0)'],[.15,'#16365f'],[.5,'#7AB2DD'],[.8,'#7AB2DD'],[1,'#E8EEF4']];
  Plotly.newPlot('camh1', [{z:g1.Z,x:xs,y:zs,type:'heatmap',colorscale:cs,zmin:0,zmax,zsmooth:'best',showscale:false,hoverinfo:'skip'}],
    heatLayout(`Through June · n = ${h1.n} sliders`, h1, `${pct(h1.below_share)} below the zone`), CFG);
  Plotly.newPlot('camh2', [{z:g2.Z,x:xs,y:zs,type:'heatmap',colorscale:cs,zmin:0,zmax,zsmooth:'best',showscale:false,hoverinfo:'skip'}],
    heatLayout(`July on · n = ${h2.n} sliders`, h2, `${pct(h2.below_share)} below the zone`), CFG);
  const M = K.monthly.filter(m=>m.pitcher===cid && m.pitch_type==='SL'); const mon = M.map(m=>new Date(m.month+'T12:00').toLocaleString('en',{month:'short'}));
  const jul = M.findIndex(m=>m.month.startsWith('2026-07'));
  Plotly.newPlot('cammonth', [
    {type:'bar', x:mon, y:M.map(m=>m.below_share), marker:{color:'#7AB2DD'}, text:M.map(m=>`n=${m.n}`), textposition:'inside'},
    {type:'scatter', mode:'lines+markers+text', x:mon, y:M.map(m=>m.whiff), line:{color:'#E8EEF4',width:3}, marker:{color:M.map(m=>m.swings>=MIN_SWINGS?'#E8EEF4':MUTED),size:8}, error_y:wilsonErr(M.map(m=>m.whiff), M.map(m=>m.swings)),
     text:M.map((m,i)=>i===M.length-1?'whiff/swing':''), textposition:'middle right', textfont:{color:'#E8EEF4'}, cliponaxis:false}],
    LAYOUT({yaxis:{tickformat:'.0%',range:[0,.95],gridcolor:GRID}, margin:{l:56,r:90,t:24,b:40},
      annotations:[{x:mon[0], y:M[0].below_share/2, text:'below-zone<br>share', showarrow:false, font:{color:'#E8EEF4',size:10}, yshift:-30},
                   callout(mon[jul], M[jul].below_share, `In July he buried ${pct(M[jul].below_share)} of his sliders, his high for the season.`, {ax:-60, ay:-50})]}), CFG);

  // ---- 4. Tunnels --------------------------------------------------------------
  const B = T.league_bins; const bl = B.map(b=>b.tunnel_bin===20?'20+':b.tunnel_bin+'–'+(b.tunnel_bin+2));
  const band = (rate, n, color) => { const lo=[], hi=[]; rate.forEach((p,i)=>{const [a,b]=wilson(Math.round(p*n[i]),n[i]); lo.push(a); hi.push(b);});
    return [{x:bl, y:hi, mode:'lines', line:{width:0}, hoverinfo:'skip', type:'scatter'}, {x:bl, y:lo, mode:'lines', line:{width:0}, fill:'tonexty', fillcolor:color, hoverinfo:'skip', type:'scatter'}]; };
  const tch = {type:'scatter', mode:'lines+markers', name:'Chase rate', x:bl, y:B.map(b=>b.chase), line:{color:'#E8EEF4',width:3}, customdata:B.map(b=>b.oz), hovertemplate:'chase %{y:.1%} (%{customdata} out-of-zone)<extra></extra>'};
  const twh = {type:'scatter', mode:'lines+markers', name:'Whiff / swing', x:bl, y:B.map(b=>b.whiff), line:{color:'#7AB2DD',width:3}, customdata:B.map(b=>b.swings), hovertemplate:'whiff %{y:.1%} (%{customdata} swings)<extra></extra>'};
  Plotly.newPlot('tunbins', [...band(B.map(b=>b.chase), B.map(b=>b.oz), 'rgba(232,238,244,.18)'), tch, ...band(B.map(b=>b.whiff), B.map(b=>b.swings), 'rgba(122,178,221,.2)'), twh],
    LAYOUT({title:{text:`MLB fastball → breaking ball · ${nFmt(B.reduce((a,b)=>a+b.n,0))} pairs · bands = 95%`,font:{size:13}}, margin:{l:56,r:90,t:44,b:56},
      xaxis:{title:'Gap between the two pitches at the tunnel point (in)',type:'category'}, yaxis:{tickformat:'.0%',range:[0,.6],gridcolor:GRID},
      annotations:[...endLabels([tch, twh]), callout(bl[0], B[0].chase, `Tight tunnels get chased ${pct(B[0].chase)} of the time vs ${pct(B[8].chase)} at ${bl[8]} in.`, {ax:70, ay:20})]}), CFG);
  const P = T.royals.filter(p=>p.n>=60).sort((a,b)=>b.whiff_rate-a.whiff_rate).slice(0,10);
  $('pairs').innerHTML = '<thead><tr><th>Pitcher</th><th>Sequence</th><th>Pairs</th><th>Tunnel gap (in)</th><th>Plate gap (in)</th><th>Plate ÷ tunnel</th><th>2nd-pitch whiff</th><th>2nd-pitch chase</th><th>RV/100</th></tr></thead><tbody>' +
    P.map(p=>`<tr><td>${nice(p.player_name)}</td><td><span style="color:${PAL[p.prev_type]}">${p.prev_type}</span> → <span style="color:${PAL[p.pitch_type]}">${p.pitch_type}</span></td><td>${p.n}</td><td>${fmt(p.tunnel_in)}</td><td>${fmt(p.plate_in)}</td><td>${fmt(p.split_ratio,2)}</td><td>${pct(p.whiff_rate)}</td><td>${pct(p.chase_rate)}</td><td>${sgn(p.rv100,2)}</td></tr>`).join('') + '</tbody>';

  // ---- 5. Counts with shrinkage -------------------------------------------------
  const csel = $('cpick'); csel.innerHTML = E.map(p=>`<option>${p.name}</option>`).join(''); csel.value = 'Lugo, Seth';
  const groupsC = ['Ahead','Even','Behind','Two strikes'];
  function drawCounts(){
    const rows = C.filter(r=>r.player_name===csel.value); const types = E.find(p=>p.name===csel.value).arsenal.map(a=>a.pitch_type);
    const use = (g,t) => (find(rows,r=>r.cnt===g&&r.pitch_type===t).usage)||0;
    const go = types.map(t=>({t,u:use('Two strikes',t)})).sort((a,b)=>b.u-a.u)[0];
    Plotly.react('cuse', types.map(t=>({type:'bar', name:t, x:groupsC, marker:{color:PAL[t]}, y:groupsC.map(g=>use(g,t)),
      text:groupsC.map(g=>use(g,t)>=0.1?t:''), textposition:'inside', insidetextanchor:'middle', textfont:{color:'#071428',size:11}, hovertemplate:t+' %{y:.0%}<extra></extra>'})),
      LAYOUT({barmode:'stack', title:{text:'Usage by count group · bars labeled by pitch',font:{size:13}}, yaxis:{tickformat:'.0%',range:[0,1.12],gridcolor:GRID}, margin:{l:56,r:16,t:56,b:46},
        annotations:[callout('Two strikes', 1.02, `With two strikes he goes to the ${go.t} ${pct(go.u)} of the time.`, {ax:-40, ay:-22, extra:{yanchor:'bottom'}})]}), CFG);
    const tr = []; let mv = {d:0};
    types.forEach((t,i)=>{ const rs2 = groupsC.map(g=>find(rows,r=>r.cnt===g&&r.pitch_type===t)); const off = (i-(types.length-1)/2)*0.1;
      rs2.forEach((r,k)=>{ if(r.n && Math.abs(r.xrv100_raw-r.xrv100_shrunk)>mv.d) mv={d:Math.abs(r.xrv100_raw-r.xrv100_shrunk), x:k+off, y:r.xrv100_raw, r, t}; });
      tr.push({type:'scatter', mode:'markers', x:groupsC.map((_,k)=>k+off), y:rs2.map(r=>r.xrv100_raw), marker:{symbol:'circle-open',size:9,color:PAL[t]}, customdata:rs2.map(r=>r.n), hovertemplate:t+' raw %{y:.2f} (n=%{customdata})<extra></extra>'});
      tr.push({type:'scatter', mode:'markers+text', x:groupsC.map((_,k)=>k+off), y:rs2.map(r=>r.xrv100_shrunk), text:rs2.map((r,k)=>k===3?t:''), textposition:'middle right', textfont:{color:PAL[t],size:10},
        marker:{size:9,color:PAL[t]}, customdata:rs2.map(r=>r.n), hovertemplate:t+' shrunk %{y:.2f} (n=%{customdata})<extra></extra>'}); });
    Plotly.react('crv', tr, LAYOUT({title:{text:'xRV / 100 by count group (○ raw, ● shrunk)',font:{size:13}}, margin:{l:56,r:30,t:44,b:46},
      xaxis:{tickvals:[0,1,2,3],ticktext:groupsC,gridcolor:GRID,range:[-0.5,3.6]}, yaxis:{title:'xRV/100 (pitcher view)',gridcolor:GRID,zerolinecolor:'#9AA3B5'},
      annotations: mv.r ? [callout(mv.x, mv.y, `The ${mv.t} ${mv.r.cnt.toLowerCase()} moves most, from ${sgn(mv.r.xrv100_raw,1)} raw to ${sgn(mv.r.xrv100_shrunk,1)} after shrinkage.`, {ax:mv.x>2?-110:60, ay:mv.y>0?40:-40})] : []}), CFG);
  }
  csel.onchange = drawCounts; drawCounts();

  // ---- 6. Fatigue ----------------------------------------------------------------
  const fp = [...new Set(F.map(f=>f.player_name))]; const fc = ['#E8EEF4','#7AB2DD','#E4572E','#43AA8B','#F29E4C','#9B5DE5','#7AB2DD','#B07A4F','#C5DCEF','#2BB3A3'];
  const ftr = fp.map((n,i)=>{ const r=F.filter(f=>f.player_name===n);
    return {type:'scatter', mode:'lines+markers', name:last(n), x:r.map(f=>f.pc_bin+7), y:r.map(f=>f.velo_delta), customdata:r.map(f=>f.n),
      error_y:{type:'data', array:r.map(f=>1.96*(f.velo_sd||0)/Math.sqrt(f.n)), color:fc[i%fc.length], thickness:1, width:2, visible:true},
      line:{color:fc[i%fc.length],width:2.2}, opacity:.9, hovertemplate:nice(n)+': %{y:+.2f} mph at ~%{x} pitches (n=%{customdata} FB)<extra></extra>'}; });
  const worst = F.reduce((a,b)=> b.velo_delta<a.velo_delta ? b : a);
  Plotly.newPlot('fat', ftr, LAYOUT({title:{text:'Fastball velo vs first 25 pitches, by pitch count (Royals starters, 70+ pitch outings)',font:{size:13}}, margin:{l:56,r:80,t:44,b:50},
      xaxis:{title:'Pitch count in game (bin midpoint)',gridcolor:GRID}, yaxis:{title:'mph vs early-game baseline',gridcolor:GRID,zerolinecolor:'#7AB2DD'},
      shapes:[{type:'line',xref:'paper',x0:0,x1:1,y0:-1,y1:-1,line:{color:'#ff8a7a',dash:'dash',width:1.5}}],
      annotations:[...endLabels(ftr), callout(worst.pc_bin+7, worst.velo_delta, `${nice(worst.player_name)} loses the most, ${sgn(worst.velo_delta,1)} mph by pitches ${worst.pc_bin}–${worst.pc_bin+14}.`, {ax:-120, ay:10})]}), CFG);

  // ---- 7. Recommendations (numbers pulled live from the data files) --------------
  const pl = (name, pt, side) => find(K.platoon, r=>r.player_name===name && r.pitch_type===pt && r.stand===side);
  const st = (name, pt) => find(K.stuff_leader, r=>r.player_name===name && r.pitch_type===pt);
  function platChart(id, name, side, types, focus, note){
    const rs2 = types.map(t=>pl(name,t,side));
    Plotly.newPlot(id, [
      {type:'bar', x:types, y:rs2.map(r=>r.xrv100), marker:{color:'rgba(154,163,181,.35)'}, offsetgroup:'raw', customdata:rs2.map(r=>r.n),
       error_y:{type:'data', array:rs2.map(r=>1.96*(r.sd100||0)/Math.sqrt(r.n||1)), color:'#9AA3B5', thickness:1, width:3}, hovertemplate:'%{x} raw %{y:.2f} ±95% (n=%{customdata})<extra></extra>'},
      {type:'bar', x:types, y:rs2.map(r=>r.xrv100_shrunk), marker:{color:types.map(t=>PAL[t])}, offsetgroup:'shr', text:rs2.map(r=>'n='+r.n), textposition:'outside', textfont:{size:10}, cliponaxis:false, hovertemplate:'%{x} shrunk %{y:.2f}<extra></extra>'}],
      LAYOUT({barmode:'group', title:{text:`${nice(name)} vs ${side}HH · xRV/100 (grey = raw ±95%, color = shrunk)`,font:{size:12}}, yaxis:{gridcolor:GRID,zerolinecolor:'#9AA3B5'}, margin:{l:46,r:10,t:40,b:40},
        annotations:[callout(focus, pl(name,focus,side).xrv100_shrunk, note, {ax:60, ay:30})]}), CFG);
  }
  { const ff=pl('Lynch IV, Daniel','FF','R'), si=pl('Lynch IV, Daniel','SI','R'), sl=pl('Lynch IV, Daniel','SL','L');
    $('rec-lynch').innerHTML = `Four-seamers to right-handed hitters: <b>${ff.n}</b> pitches, <b>${pct(ff.whiff)}</b> whiff per swing, <b>${fmt(ff.xwoba_con,3).replace(/^0/,'')}</b> xwOBA on contact, xRV/100 <b>${sgn(ff.xrv100_shrunk,2)}</b> after shrinkage (raw ${sgn(ff.xrv100,2)}). Stuff+ <b>${st('Lynch IV, Daniel','FF').stuff_plus}</b>, his lowest grade. His sinker to righties: <b>${si.n}</b> pitches at <b>${sgn(si.xrv100_shrunk,2)}</b> (Stuff+ ${st('Lynch IV, Daniel','SI').stuff_plus}). Against lefties the slider is the weapon: <b>${pct(sl.whiff)}</b> whiffs and <b>${fmt(sl.xwoba_con,3).replace(/^0/,'')}</b> xwOBA on contact. <span class="muted">Confidence: medium. The four-seamer is a ${ff.n}-pitch sample, but it's the worst pitch on both shape and results.</span>`;
    platChart('c-lynch','Lynch IV, Daniel','R',['FF','SI','CH','KC','SL'],'FF',`FF ${sgn(ff.xrv100_shrunk,1)} shrunk`); }
  { const ff=pl('Lugo, Seth','FF','L'), fc2=pl('Lugo, Seth','FC','L');
    const ab=find(K.regions, r=>r.player_name==='Lugo, Seth'&&r.pitch_type==='FF'&&r.region==='Chase-Above');
    $('rec-lugo').innerHTML = `To lefties, Lugo's four-seamer is his most-hit pitch: <b>${ff.n}</b> pitches, <b>${fmt(ff.xwoba_con,3).replace(/^0/,'')}</b> xwOBA on contact, <b>${pct(ff.whiff)}</b> whiffs, xRV/100 <b>${sgn(ff.xrv100_shrunk,2)}</b> shrunk. Its Stuff+ is <b>${st('Lugo, Seth','FF').stuff_plus}</b>. The cutter to lefties (<b>${fc2.n}</b> pitches) gets <b>${pct(fc2.whiff)}</b> whiffs at <b>${sgn(fc2.xrv100_shrunk,2)}</b>, his best-graded pitch against them. When the four-seamer misses above the zone (all hitters), hitters whiff on <b>${pct(ab.whiff)}</b> of their swings (${ab.swings} swings), so keep it there as a chase pitch. <span class="muted">Confidence: medium-high. 300+ pitches on each side of the comparison.</span>`;
    platChart('c-lugo','Lugo, Seth','L',['FF','FC','SI','CU','CH','ST','SL'],'FC',`FC ${sgn(fc2.xrv100_shrunk,2)}: best vs LHH`); }
  { const w1 = wilson(h1.whiffs, h1.swings), w2 = wilson(h2.whiffs, h2.swings);
    $('rec-cam').innerHTML = `Before July: <b>${pct(h1.below_share)}</b> of sliders below the zone, xRV/100 <b>${sgn(h1.xrv100,2)}</b> (${h1.n} pitches). From July on: <b>${pct(h2.below_share)}</b> below, <b>${sgn(h2.xrv100,2)}</b> (${h2.n} pitches). Whiffs per swing went from <b>${pct(h1.whiffs/h1.swings,1)}</b> (95% ${pct(w1[0])}–${pct(w1[1])}, ${h1.swings} swings) to <b>${pct(h2.whiffs/h2.swings,1)}</b> (95% ${pct(w2[0])}–${pct(w2[1])}, ${h2.swings} swings). The slider's damage came in the middle of the zone. <span class="muted">Confidence: ${w1[1] < w2[0] ? 'high on direction. The 95% intervals don\'t overlap' : 'moderate. The 95% intervals overlap slightly'}, and the league slider rate stayed flat.</span>`;
    Plotly.newPlot('c-cam', [
      {type:'bar', x:['Through June','July on'], y:[h1.below_share,h2.below_share], offsetgroup:'a', marker:{color:'#7AB2DD'}, text:[`below ${pct(h1.below_share)}`,`below ${pct(h2.below_share)}`], textposition:'inside'},
      {type:'bar', x:['Through June','July on'], y:[h1.middle_share,h2.middle_share], offsetgroup:'b', marker:{color:'#E4572E'}, text:[`middle ${pct(h1.middle_share)}`,`middle ${pct(h2.middle_share)}`], textposition:'outside', cliponaxis:false},
      {type:'scatter', mode:'markers+text', x:['Through June','July on'], y:[h1.whiffs/h1.swings, h2.whiffs/h2.swings], marker:{color:'#E8EEF4',size:11,symbol:'diamond'},
       error_y:wilsonErr([h1.whiffs/h1.swings, h2.whiffs/h2.swings],[h1.swings,h2.swings]), text:['whiff/swing',''], textposition:'middle left', textfont:{color:'#E8EEF4',size:10}}],
      LAYOUT({barmode:'group', title:{text:`Cameron slider location (n = ${h1.n} → ${h2.n})`,font:{size:12}}, yaxis:{tickformat:'.0%',range:[0,.8],gridcolor:GRID}, margin:{l:46,r:10,t:40,b:40},
        annotations:[callout('July on', h2.whiffs/h2.swings, `Whiffs per swing went from ${pct(h1.whiffs/h1.swings)} to ${pct(h2.whiffs/h2.swings)}.`, {ax:-70, ay:-30})]}), CFG); }
  { const cz=find(V.pitchers, p=>p.player_name==='Cruz, Steven'); const arsF=find(E.find(p=>p.name==='Cruz, Steven').arsenal, a=>a.pitch_type==='FF');
    const royF = V.pitchers.filter(p=>p.is_royals); const rank = [...royF].sort((a,b)=>b.vaa_adj-a.vaa_adj).findIndex(p=>p.player_name==='Cruz, Steven')+1;
    $('rec-cruz').innerHTML = `Cruz's four-seamer averages <b>${fmt(arsF.velo)}</b> mph with a location-adjusted VAA of <b>${sgn(cz.vaa_adj,2)}°</b>, the #${rank} flattest of the ${royF.length} Royals four-seamers with 200+ pitches. Hitters whiff on <b>${pct(cz.high_whiff)}</b> of swings at it in the top third (${cz.high_sw} swings), vs <b>${pct(cz.low_whiff)}</b> in the bottom third (${cz.low_sw} swings), but only <b>${pct(cz.high_share)}</b> of his four-seamers finish up there. Stuff+ <b>${arsF.stuff_plus}</b>. <span class="muted">Confidence: high on the top-third rate; the bottom-third sample is small. It matches the league-wide VAA pattern in section 2.</span>`;
    Plotly.newPlot('c-cruz', [{type:'bar', x:['Top third','Bottom third'], y:[cz.high_whiff, cz.low_whiff], marker:{color:[cz.high_sw>=MIN_SWINGS?PAL.FF:MUTED, cz.low_sw>=MIN_SWINGS?'#7AB2DD':MUTED]},
      error_y:wilsonErr([cz.high_whiff, cz.low_whiff],[cz.high_sw, cz.low_sw]), text:[`n=${cz.high_sw} swings`,`n=${cz.low_sw} swings`], textposition:'inside'}],
      LAYOUT({title:{text:'Cruz four-seam whiff / swing by height (95% intervals)',font:{size:12}}, yaxis:{tickformat:'.0%',range:[0,.6],gridcolor:GRID}, margin:{l:46,r:10,t:40,b:40},
        annotations:[callout('Top third', cz.high_whiff, `Hitters whiff on ${pct(cz.high_whiff)} of swings at his four-seamer in the top third.`, {ax:90, ay:-20})]}), CFG); }
});
