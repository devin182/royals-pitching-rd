// Research page: every figure below is read from site/data/*.json (built by R/03_analysis.R)
const $ = id => document.getElementById(id);
const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
const find = (arr, f) => arr.find(f) || {};
Promise.all(['stuff','vaa','tunnel','counts','fatigue','cases','explorer'].map(n => getJSON(`data/${n}.json`))).then(([S,V,T,C,F,K,E]) => {
  // ---- 1. Stuff+
  const v = S.validation; set('split', v.split_date); set('nval', v.n_pitch_types); set('rwhiff', fmt(v.cor_stuff_whiff,2));
  $('valtbl').innerHTML = '<thead><tr><th>Model</th><th>Train</th><th>Holdout</th><th>Trees</th><th>R²</th><th>cor(RV)</th><th>cor(whiff)</th></tr></thead><tbody>' +
    v.pitch_level.map(m => `<tr><td>${m.group}</td><td>${m.n_train.toLocaleString()}</td><td>${m.n_test.toLocaleString()}</td><td>${m.nrounds}</td><td>${fmt(m.r2_pitch,4)}</td><td>${fmt(m.cor_pitch,3)}</td><td>${fmt(m.cor_whiff,3)}</td></tr>`).join('') + '</tbody>';
  Plotly.newPlot('valchart', [{type:'bar', orientation:'h',
    y:['Early-season run value','Early-season expected RV','Early-season Stuff+'],
    x:[v.cor_rv_early_vs_rv_late, v.cor_xrv_early_vs_rv_late, v.cor_stuff_early_vs_rv_late],
    marker:{color:['#5b6b7f','#7AB2DD','#C9A227']}, text:[v.cor_rv_early_vs_rv_late, v.cor_xrv_early_vs_rv_late, v.cor_stuff_early_vs_rv_late].map(x=>'r = '+fmt(x,3)),
    textposition:'outside', hoverinfo:'skip'}],
    LAYOUT({title:{text:'Predicting late-season run value',font:{size:14}}, margin:{l:170,r:40,t:40,b:40}, xaxis:{range:[0,0.25],gridcolor:'#1f3d66',title:'correlation'}}), CFG);
  const L = S.league, roy = L.filter(d=>d.royals), oth = L.filter(d=>!d.royals);
  Plotly.newPlot('stuffscatter', [
    {x:oth.map(d=>d.stuff_plus), y:oth.map(d=>d.whiff), mode:'markers', type:'scatter', name:'MLB', marker:{color:'rgba(122,178,221,.28)',size:5}, hoverinfo:'skip'},
    {x:roy.map(d=>d.stuff_plus), y:roy.map(d=>d.whiff), mode:'markers', type:'scatter', name:'Royals', text:roy.map(d=>`${nice(d.name)} ${d.pitch_type} (${d.n})`),
     marker:{color:'#C9A227',size:9,line:{color:'#071428',width:1}}, hovertemplate:'%{text}<br>Stuff+ %{x} · whiff %{y:.1%}<extra></extra>'}],
    LAYOUT({title:{text:'Stuff+ vs whiff rate',font:{size:14}}, xaxis:{title:'Stuff+',gridcolor:'#1f3d66'}, yaxis:{title:'Whiff / swing',tickformat:'.0%',gridcolor:'#1f3d66'}}), CFG);
  const groups = ['Fastball','Breaking','Offspeed'], gc = {Fastball:'#E8EEF4',Breaking:'#C9A227',Offspeed:'#6fd3a0'};
  const feats = [...new Set(S.importance.map(d=>d.feature))];
  const pretty = {release_speed:'Velocity',ivb:'IVB',hb_arm:'HB (arm side)',release_spin_rate:'Spin rate',spin_axis_arm:'Spin axis',release_extension:'Extension',
    release_pos_z:'Release height',rel_side_arm:'Release side',arm_angle:'Arm angle',velo_diff:'Velo gap vs FB',ivb_diff:'IVB gap vs FB',hb_diff:'HB gap vs FB'};
  Plotly.newPlot('imp', groups.map(g => ({type:'bar', orientation:'h', name:g, marker:{color:gc[g]},
      y:feats.map(f=>pretty[f]||f), x:feats.map(f=>(find(S.importance, d=>d.group===g&&d.feature===f).gain)||0), hovertemplate:g+' %{y}: %{x:.3f}<extra></extra>'})),
    LAYOUT({barmode:'group', title:{text:'Feature importance (gain)',font:{size:14}}, margin:{l:120,r:10,t:40,b:60}, yaxis:{autorange:'reversed'}, xaxis:{gridcolor:'#1f3d66'}}), CFG);
  const ld = K.stuff_leader, row = d => `<tr><td>${nice(d.player_name)}</td><td>${d.pitch_type}</td><td>${d.n}</td><td><span class="sp" style="background:${stuffColor(d.stuff_plus)}">${d.stuff_plus}</span></td><td>${sgn(d.xrv100,2)}</td><td>${sgn(d.rv100,2)}</td></tr>`;
  const head = '<thead><tr><th>Pitcher</th><th>Pitch</th><th>#</th><th>Stuff+</th><th>xRV/100</th><th>RV/100</th></tr></thead>';
  $('lead').innerHTML = head + '<tbody>' + ld.slice(0,8).map(row).join('') + '</tbody>';
  $('lag').innerHTML = head + '<tbody>' + ld.slice(-8).reverse().map(row).join('') + '</tbody>';
  // ---- 2. VAA
  set('vaar2', fmt(V.r2,2)); const Q = V.league_quintiles;
  set('q5hi', pct(Q[4].whiff,1)); set('q1hi', pct(Q[0].whiff,1)); set('q1lo', pct(Q[0].low_whiff,1)); set('q5lo', pct(Q[4].low_whiff,1));
  const ql = ['Steepest','Q2','Q3','Q4','Flattest'];
  Plotly.newPlot('vaaq', [
    {type:'bar', name:'Top third of zone', x:ql, y:Q.map(q=>q.whiff), marker:{color:'#C9A227'}, text:Q.map(q=>pct(q.whiff)), textposition:'outside'},
    {type:'bar', name:'Bottom third of zone', x:ql, y:Q.map(q=>q.low_whiff), marker:{color:'#4f86c6'}, text:Q.map(q=>pct(q.low_whiff)), textposition:'outside'}],
    LAYOUT({title:{text:'MLB four-seam whiff/swing by location-adjusted VAA quintile',font:{size:13}}, yaxis:{tickformat:'.0%',range:[0,.42],gridcolor:'#1f3d66'}}), CFG);
  const vr = V.pitchers.filter(p=>p.is_royals);
  Plotly.newPlot('vaaroy', [{x:vr.map(p=>p.vaa_adj), y:vr.map(p=>p.high_whiff), mode:'markers+text', type:'scatter', text:vr.map(p=>nice(p.player_name).split(' ').slice(-1)[0]),
    textposition:'top center', textfont:{color:'#C5DCEF',size:11}, customdata:vr.map(p=>[p.n, p.vaa, p.high_share]),
    marker:{size:vr.map(p=>Math.sqrt(p.n)*1.1), color:'#7AB2DD', opacity:.85, line:{color:'#071428',width:1}},
    hovertemplate:'%{text}<br>VAA adj %{x:+.2f}° (raw %{customdata[1]:.1f}°)<br>high-zone whiff %{y:.0%}<br>%{customdata[0]} FF, %{customdata[2]:.0%} up<extra></extra>'}],
    LAYOUT({title:{text:'Royals four-seamers: flatness vs high-zone whiffs',font:{size:14}}, xaxis:{title:'Location-adjusted VAA (° , + = flatter)',gridcolor:'#1f3d66',zerolinecolor:'#C9A227'}, yaxis:{title:'Whiff / swing, top third',tickformat:'.0%',gridcolor:'#1f3d66'}}), CFG);
  // ---- 3. Cameron slider
  const cam = E.find(p=>p.name==='Cameron, Noah'); const cid = cam.id;
  const R = K.regions.filter(r=>r.pitcher===cid && r.pitch_type==='SL'); const reg = ['Chase-Above','Zone-High','Zone-Middle','Zone-Low','Chase-Below','Chase-Side'];
  const rr = reg.map(g=>find(R, r=>r.region===g));
  set('cambelow', pct(find(R,r=>r.region==='Chase-Below').whiff)); set('cammid', pct(find(R,r=>r.region==='Zone-Middle').whiff));
  const H = K.halves.filter(h=>h.pitcher===cid && h.pitch_type==='SL');
  set('cam1b', pct(find(H,h=>!h.second_half).below_share)); set('cam2b', pct(find(H,h=>h.second_half).below_share));
  Plotly.newPlot('camreg', [
    {type:'bar', name:'Whiff / swing', x:reg, y:rr.map(r=>r.whiff), marker:{color:'#7AB2DD'}, text:rr.map(r=>r.n+' p'), textposition:'outside'},
    {type:'scatter', mode:'markers', name:'xRV / 100', x:reg, y:rr.map(r=>r.xrv100), yaxis:'y2', marker:{symbol:'diamond',size:13,color:'#C9A227'}}],
    LAYOUT({title:{text:'Noah Cameron · slider by region',font:{size:14}}, yaxis:{tickformat:'.0%',range:[0,.8],gridcolor:'#1f3d66',title:'whiff / swing'},
      yaxis2:{overlaying:'y',side:'right',title:'xRV / 100',zeroline:true,zerolinecolor:'#C9A227',showgrid:false}, margin:{l:56,r:56,t:40,b:70}}), CFG);
  const M = K.monthly.filter(m=>m.pitcher===cid && m.pitch_type==='SL'); const mon = M.map(m=>new Date(m.month+'T12:00').toLocaleString('en',{month:'short'}));
  Plotly.newPlot('cammonth', [
    {type:'bar', name:'Below-zone share', x:mon, y:M.map(m=>m.below_share), marker:{color:'#4f86c6'}, text:M.map(m=>m.n+' SL'), textposition:'inside'},
    {type:'scatter', mode:'lines+markers', name:'Whiff / swing', x:mon, y:M.map(m=>m.whiff), line:{color:'#C9A227',width:3}}],
    LAYOUT({yaxis:{tickformat:'.0%',range:[0,.85],gridcolor:'#1f3d66'}, margin:{l:56,r:16,t:20,b:60}}), CFG);
  // ---- 4. Tunnels
  const B = T.league_bins;
  Plotly.newPlot('tunbins', [
    {type:'scatter', mode:'lines+markers', name:'Chase rate', x:B.map(b=>b.tunnel_bin===20?'20+':b.tunnel_bin+'–'+(b.tunnel_bin+2)), y:B.map(b=>b.chase), line:{color:'#C9A227',width:3}},
    {type:'scatter', mode:'lines+markers', name:'Whiff / swing', x:B.map(b=>b.tunnel_bin===20?'20+':b.tunnel_bin+'–'+(b.tunnel_bin+2)), y:B.map(b=>b.whiff), line:{color:'#7AB2DD',width:3}}],
    LAYOUT({title:{text:'MLB fastball → breaking ball, by tunnel distance',font:{size:14}}, xaxis:{title:'Distance between the two pitches at the tunnel point (in)',type:'category'}, yaxis:{tickformat:'.0%',range:[0,.6],gridcolor:'#1f3d66'}}), CFG);
  const P = T.royals.filter(p=>p.n>=60).sort((a,b)=>b.whiff_rate-a.whiff_rate).slice(0,10);
  $('pairs').innerHTML = '<thead><tr><th>Pitcher</th><th>Sequence</th><th>Pairs</th><th>Tunnel gap (in)</th><th>Plate gap (in)</th><th>Plate ÷ tunnel</th><th>2nd-pitch whiff</th><th>2nd-pitch chase</th><th>RV/100</th></tr></thead><tbody>' +
    P.map(p=>`<tr><td>${nice(p.player_name)}</td><td>${p.prev_type} → ${p.pitch_type}</td><td>${p.n}</td><td>${fmt(p.tunnel_in)}</td><td>${fmt(p.plate_in)}</td><td>${fmt(p.split_ratio,2)}</td><td>${pct(p.whiff_rate)}</td><td>${pct(p.chase_rate)}</td><td>${sgn(p.rv100,2)}</td></tr>`).join('') + '</tbody>';
  // ---- 5. Counts with shrinkage
  const cs = $('cpick'); const ppl = E.map(p=>p.name); cs.innerHTML = ppl.map(n=>`<option>${n}</option>`).join('');
  cs.value = 'Lugo, Seth';
  const groupsC = ['Ahead','Even','Behind','Two strikes'];
  function drawCounts(){
    const rows = C.filter(r=>r.player_name===cs.value); const types = E.find(p=>p.name===cs.value).arsenal.map(a=>a.pitch_type);
    Plotly.react('cuse', types.map(t=>({type:'bar', name:t, x:groupsC, marker:{color:PAL[t]},
      y:groupsC.map(g=>(find(rows,r=>r.cnt===g&&r.pitch_type===t).usage)||0), hovertemplate:t+' %{y:.0%}<extra></extra>'})),
      LAYOUT({barmode:'stack', title:{text:'Usage by count group',font:{size:14}}, yaxis:{tickformat:'.0%',gridcolor:'#1f3d66'}}), CFG);
    const tr = [];
    types.forEach((t,i)=>{ const rs = groupsC.map(g=>find(rows,r=>r.cnt===g&&r.pitch_type===t));
      const off = (i-(types.length-1)/2)*0.1;
      tr.push({type:'scatter', mode:'markers', name:t+' raw', showlegend:false, x:groupsC.map((_,k)=>k+off), y:rs.map(r=>r.xrv100_raw),
        marker:{symbol:'circle-open',size:9,color:PAL[t]}, customdata:rs.map(r=>r.n), hovertemplate:t+' raw %{y:.2f} (n=%{customdata})<extra></extra>'});
      tr.push({type:'scatter', mode:'markers', name:t, x:groupsC.map((_,k)=>k+off), y:rs.map(r=>r.xrv100_shrunk),
        marker:{size:9,color:PAL[t]}, customdata:rs.map(r=>r.n), hovertemplate:t+' shrunk %{y:.2f} (n=%{customdata})<extra></extra>'}); });
    Plotly.react('crv', tr, LAYOUT({title:{text:'xRV / 100 by count group (hollow raw, filled shrunk)',font:{size:13}},
      xaxis:{tickvals:[0,1,2,3],ticktext:groupsC,gridcolor:'#1f3d66'}, yaxis:{title:'xRV/100 (pitcher view)',gridcolor:'#1f3d66',zerolinecolor:'#C9A227'}}), CFG);
  }
  cs.onchange = drawCounts; drawCounts();
  // ---- 6. Fatigue
  const fp = [...new Set(F.map(f=>f.player_name))]; const fc = ['#E8EEF4','#7AB2DD','#C9A227','#6fd3a0','#f08a3c','#b38ce0','#4f86c6','#d77b5b','#C5DCEF','#3fb489'];
  Plotly.newPlot('fat', fp.map((n,i)=>{ const r=F.filter(f=>f.player_name===n);
    return {type:'scatter', mode:'lines+markers', name:nice(n), x:r.map(f=>f.pc_bin+7), y:r.map(f=>f.velo_delta), customdata:r.map(f=>f.n),
      line:{color:fc[i%fc.length],width:2.5}, hovertemplate:nice(n)+': %{y:+.2f} mph at ~%{x} pitches (%{customdata} FB)<extra></extra>'}; }),
    LAYOUT({title:{text:'Fastball velo vs first 25 pitches, by pitch count',font:{size:14}}, xaxis:{title:'Pitch count in game (bin midpoint)',gridcolor:'#1f3d66'},
      yaxis:{title:'mph vs early-game baseline',gridcolor:'#1f3d66',zerolinecolor:'#7AB2DD'},
      shapes:[{type:'line',xref:'paper',x0:0,x1:1,y0:-1,y1:-1,line:{color:'#ff8a7a',dash:'dash',width:1.5}}]}), CFG);
  // ---- 7. Recommendations (numbers pulled live from the data files)
  const pl = (name, pt, side) => find(K.platoon, r=>r.player_name===name && r.pitch_type===pt && r.stand===side);
  const st = (name, pt) => find(K.stuff_leader, r=>r.player_name===name && r.pitch_type===pt);
  function platChart(id, name, side, types){
    const rs = types.map(t=>pl(name,t,side));
    Plotly.newPlot(id, [
      {type:'bar', name:'Raw', x:types, y:rs.map(r=>r.xrv100), marker:{color:'rgba(122,178,221,.35)'}, customdata:rs.map(r=>r.n), hovertemplate:'%{x} raw %{y:.2f} (n=%{customdata})<extra></extra>'},
      {type:'bar', name:'Shrunk', x:types, y:rs.map(r=>r.xrv100_shrunk), marker:{color:types.map(t=>PAL[t])}, text:rs.map(r=>r.n+' p'), textposition:'outside', hovertemplate:'%{x} shrunk %{y:.2f}<extra></extra>'}],
      LAYOUT({barmode:'group', title:{text:`${nice(name)} vs ${side}HH · xRV/100 by pitch`,font:{size:13}}, yaxis:{gridcolor:'#1f3d66',zerolinecolor:'#C9A227'}, margin:{l:46,r:10,t:36,b:50}}), CFG);
  }
  // Lynch
  { const ff=pl('Lynch IV, Daniel','FF','R'), si=pl('Lynch IV, Daniel','SI','R'), sl=pl('Lynch IV, Daniel','SL','L');
    $('rec-lynch').innerHTML = `Four-seamers to right-handed hitters: <b>${ff.n}</b> pitches, <b>${pct(ff.whiff)}</b> whiff per swing, <b>${fmt(ff.xwoba_con,3).replace(/^0/,'')}</b> xwOBA on contact, xRV/100 <b>${sgn(ff.xrv100_shrunk,2)}</b> after shrinkage (raw ${sgn(ff.xrv100,2)}). Stuff+ <b>${st('Lynch IV, Daniel','FF').stuff_plus}</b>, his lowest grade. His sinker to righties: <b>${si.n}</b> pitches at <b>${sgn(si.xrv100_shrunk,2)}</b> (Stuff+ ${st('Lynch IV, Daniel','SI').stuff_plus}). Against lefties the slider is the weapon: <b>${pct(sl.whiff)}</b> whiffs and <b>${fmt(sl.xwoba_con,3).replace(/^0/,'')}</b> xwOBA on contact. <span class="muted">Confidence: medium. The four-seamer is a 167-pitch sample, but it's the worst pitch on both shape and results.</span>`;
    platChart('c-lynch','Lynch IV, Daniel','R',['FF','SI','CH','KC','SL']); }
  // Lugo
  { const ff=pl('Lugo, Seth','FF','L'), fc=pl('Lugo, Seth','FC','L');
    const ab=find(K.regions, r=>r.player_name==='Lugo, Seth'&&r.pitch_type==='FF'&&r.region==='Chase-Above');
    $('rec-lugo').innerHTML = `To lefties, Lugo's four-seamer is his most-hit pitch: <b>${ff.n}</b> pitches, <b>${fmt(ff.xwoba_con,3).replace(/^0/,'')}</b> xwOBA on contact, <b>${pct(ff.whiff)}</b> whiffs, xRV/100 <b>${sgn(ff.xrv100_shrunk,2)}</b> shrunk. Its Stuff+ is <b>${st('Lugo, Seth','FF').stuff_plus}</b>. The cutter to lefties (<b>${fc.n}</b> pitches) gets <b>${pct(fc.whiff)}</b> whiffs at <b>${sgn(fc.xrv100_shrunk,2)}</b>, his best-graded pitch against them. When the four-seamer misses above the zone (all hitters), hitters whiff on <b>${pct(ab.whiff)}</b> of their swings (${ab.swings} swings), so keep it there as a chase pitch. <span class="muted">Confidence: medium-high. 300+ pitches on each side of the comparison.</span>`;
    platChart('c-lugo','Lugo, Seth','L',['FF','FC','SI','CU','CH','ST','SL']); }
  // Cameron
  { const h1=find(H,h=>!h.second_half), h2=find(H,h=>h.second_half);
    $('rec-cam').innerHTML = `Before July: <b>${pct(h1.below_share)}</b> of sliders below the zone, xRV/100 <b>${sgn(h1.xrv100,2)}</b> (${h1.n} pitches). From July on: <b>${pct(h2.below_share)}</b> below, <b>${sgn(h2.xrv100,2)}</b> (${h2.n} pitches), and whiffs per swing doubled from 21.8% to 42.2%. The slider's damage came in the middle of the zone. <span class="muted">Confidence: high on direction. The whiff gain is large while the league rate stayed flat.</span>`;
    Plotly.newPlot('c-cam', [{type:'bar', x:['Through June','July on'], y:[h1.below_share,h2.below_share], name:'Below-zone share', marker:{color:'#4f86c6'}, text:[pct(h1.below_share),pct(h2.below_share)], textposition:'outside'},
      {type:'bar', x:['Through June','July on'], y:[h1.middle_share,h2.middle_share], name:'Middle-of-zone share', marker:{color:'#ff8a7a'}, text:[pct(h1.middle_share),pct(h2.middle_share)], textposition:'outside'}],
      LAYOUT({barmode:'group', title:{text:'Cameron slider location',font:{size:13}}, yaxis:{tickformat:'.0%',range:[0,.75],gridcolor:'#1f3d66'}, margin:{l:46,r:10,t:36,b:50}}), CFG); }
  // Cruz
  { const cz=find(V.pitchers, p=>p.player_name==='Cruz, Steven'); const arsF=find(E.find(p=>p.name==='Cruz, Steven').arsenal, a=>a.pitch_type==='FF');
    const rank = V.pitchers.filter(p=>p.is_royals).sort((a,b)=>b.vaa_adj-a.vaa_adj).findIndex(p=>p.player_name==='Cruz, Steven')+1;
    $('rec-cruz').innerHTML = `Cruz's four-seamer averages <b>${fmt(arsF.velo)}</b> mph with a location-adjusted VAA of <b>${sgn(cz.vaa_adj,2)}°</b>, the #${rank} flattest of the ${V.pitchers.filter(p=>p.is_royals).length} Royals four-seamers with 200+ pitches. Hitters whiff on <b>${pct(cz.high_whiff)}</b> of swings at it in the top third, vs <b>${pct(cz.low_whiff)}</b> in the bottom third, but only <b>${pct(cz.high_share)}</b> of his four-seamers finish up there. Stuff+ <b>${arsF.stuff_plus}</b>. <span class="muted">Confidence: high. It matches the league-wide VAA pattern in section 2.</span>`;
    Plotly.newPlot('c-cruz', [{type:'bar', x:['Top third','Bottom third'], y:[cz.high_whiff, cz.low_whiff], marker:{color:['#C9A227','#4f86c6']}, text:[pct(cz.high_whiff),pct(cz.low_whiff)], textposition:'outside'}],
      LAYOUT({title:{text:'Cruz four-seam whiff / swing by height',font:{size:13}}, yaxis:{tickformat:'.0%',range:[0,.5],gridcolor:'#1f3d66'}, showlegend:false, margin:{l:46,r:10,t:36,b:40}}), CFG); }
});
