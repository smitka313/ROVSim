/* Extras: design log (engineering journal), printable shop sheet and heat replay drawing. */
(function () {
  const U = window.UIVD;
  const { PARTS, ELECTRICAL, DIRS, FITTINGS, Design } = U;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt$ = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const mmss = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0'); };

  /* ---------- design log ---------- */
  function designHash(d) {
    const parts = d.parts.map(p => [p.type, p.at.join(','), p.dir, p.tilt || 0, p.qty || 1].join('|')).sort();
    const str = JSON.stringify([d.pipes.map(p => [p.a, p.b].map(v => v.join(',')).sort().join('-')).sort(), parts, d.elec, !!d.sealed]);
    let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function designStats(d) {
    const mp = Design.massProps(d), B = Design.bom(d), b = Design.bounds(d);
    const thr = d.parts.filter(p => PARTS[p.type] && PARTS[p.type].kind === 'thruster');
    return {
      cost: B.total, net: Math.round(mp.net), mass: Math.round(mp.M), pitch: mp.sep > 0.002 ? +mp.pitch.toFixed(1) : null,
      motors: thr.length, amps: +Design.fullPowerAmps(d).toFixed(1), size: b.size.map(v => Math.round(v)),
      tools: d.parts.filter(p => PARTS[p.type] && PARTS[p.type].kind === 'tool').map(p => PARTS[p.type].short)
    };
  }

  function countParts(d) {
    const c = {};
    d.parts.forEach(p => { const P = PARTS[p.type]; if (P) c[P.short] = (c[P.short] || 0) + (p.qty || 1); });
    return c;
  }

  // Plain-language list of what changed between two designs
  function changeSummary(a, b) {
    if (!a) return ['First version'];
    const out = [];
    if (a.box && b.box) {
      ['w', 'h', 'l'].forEach(k => { if (a.box[k] !== b.box[k]) out.push(`Frame ${({ w: 'width', h: 'height', l: 'length' })[k]} ${a.box[k]} → ${b.box[k]} in`); });
      ['top', 'bottom', 'mid'].forEach(k => { if (!!a.box[k] !== !!b.box[k]) out.push(`${b.box[k] ? 'Added' : 'Removed'} ${({ top: 'top crossbar', bottom: 'bottom crossbar', mid: 'side rails' })[k]}`); });
    } else if (a.pipes.length !== b.pipes.length) out.push(`Frame pipes ${a.pipes.length} → ${b.pipes.length}`);
    if (!!a.sealed !== !!b.sealed) out.push(b.sealed ? 'Sealed the frame' : 'Flooded the frame');
    const ca = countParts(a), cb = countParts(b);
    new Set([...Object.keys(ca), ...Object.keys(cb)]).forEach(k => {
      const d = (cb[k] || 0) - (ca[k] || 0);
      if (d) out.push(`${d > 0 ? '+' : '−'}${Math.abs(d)} ${k}`);
    });
    const moved = b.parts.filter(p => { const q = a.parts.find(x => x.id === p.id); return q && (q.at.join() !== p.at.join() || q.dir !== p.dir || (q.tilt || 0) !== (p.tilt || 0)); }).length;
    if (moved) out.push(`Moved or turned ${moved} part${moved > 1 ? 's' : ''}`);
    Object.keys(ELECTRICAL).forEach(k => { if (a.elec[k] !== b.elec[k]) out.push(`${ELECTRICAL[k].label}: ${ELECTRICAL[k].options[b.elec[k]].name}`); });
    return out.length ? out : ['Small changes'];
  }

  function journalHtml(J, team, rov) {
    const vs = J.versions;
    const rows = vs.map(v => `<section><h2>v${v.v} <small>${new Date(v.at).toLocaleString()}</small></h2>
      <p><b>Changes:</b> ${v.changes.map(esc).join(' · ')}</p>
      <table><tr><th>Cost</th><th>Buoyancy</th><th>Mass</th><th>Motors</th><th>Full power</th><th>Size (in)</th></tr>
      <tr><td>${fmt$(v.stats.cost)}</td><td>${v.stats.net >= 0 ? '+' : ''}${v.stats.net} g</td><td>${v.stats.mass} g</td><td>${v.stats.motors}</td><td>${v.stats.amps} A</td><td>${v.stats.size.join(' × ')}</td></tr></table>
      ${v.tests.length ? `<h3>Tests</h3><table><tr><th>When</th><th>Test</th><th>Result</th><th>Top speed</th></tr>${v.tests.map(t => `<tr><td>${new Date(t.at).toLocaleTimeString()}</td><td>${esc(t.label)}</td><td>${esc(t.result)}</td><td>${t.topSpeed != null ? t.topSpeed.toFixed(2) + ' m/s' : ''}</td></tr>`).join('')}</table>` : '<p><i>No tests yet.</i></p>'}
      ${v.note ? `<h3>Our notes</h3><p>${esc(v.note).replace(/\n/g, '<br>')}</p>` : ''}</section>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Design log: ${esc(rov)}</title><style>
      body{font-family:Segoe UI,system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#14232a;line-height:1.5}
      h1{margin:0}h2{margin:18px 0 4px;font-size:18px;border-top:2px solid #007c8a;padding-top:10px}h2 small{font-weight:400;color:#586a72;font-size:13px}
      h3{font-size:14px;margin:10px 0 4px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d2dde0;padding:4px 8px;text-align:left}th{background:#f3f7f8}
      .print{float:right;padding:6px 12px}@media print{.print{display:none}}</style></head><body>
      <button class="print" onclick="window.print()">Print</button>
      <h1>Design log: ${esc(rov)}</h1><p>Team: ${esc(team || '—')} · Underwater IVD 2026–27 · ${vs.length} version${vs.length === 1 ? '' : 's'}, ${vs.reduce((a, v) => a + v.tests.length, 0)} tests</p>
      <p>This log shows our design spiral: each version, what we changed, how we tested it, and what we learned.</p>${rows}</body></html>`;
  }

  /* ---------- shop sheet ---------- */
  function orthoSvg(d, axH, axV, flipV, title, hLabel, vLabel) {
    const pts = [];
    d.pipes.forEach(p => pts.push(p.a, p.b));
    d.parts.forEach(p => pts.push(p.at));
    if (!pts.length) return '';
    const W = 300, H = 230, pad = 34;
    const lo = [0, 1, 2].map(i => Math.min(...pts.map(q => q[i]))), hi = [0, 1, 2].map(i => Math.max(...pts.map(q => q[i])));
    const sc = Math.min((W - 2 * pad) / Math.max(1, hi[axH] - lo[axH]), (H - 2 * pad) / Math.max(1, hi[axV] - lo[axV]));
    const X = v => pad + (v[axH] - lo[axH]) * sc, Y = v => flipV ? pad + (v[axV] - lo[axV]) * sc : H - pad - (v[axV] - lo[axV]) * sc;
    const pipes = d.pipes.map(p => `<line x1="${X(p.a)}" y1="${Y(p.a)}" x2="${X(p.b)}" y2="${Y(p.b)}" stroke="#7a8a90" stroke-width="${Math.max(3, 0.84 * sc)}" stroke-linecap="round"/>`).join('');
    const parts = d.parts.map((p, i) => `<circle cx="${X(p.at)}" cy="${Y(p.at)}" r="8" fill="#ffffff" stroke="#007c8a" stroke-width="2"/><text x="${X(p.at)}" y="${Y(p.at) + 3.5}" font-size="10" text-anchor="middle" font-weight="700" fill="#007c8a">${i + 1}</text>`).join('');
    const fl = [0, 1, 2].map(i => Math.min(...d.pipes.flatMap(p => [p.a[i], p.b[i]]))), fh = [0, 1, 2].map(i => Math.max(...d.pipes.flatMap(p => [p.a[i], p.b[i]])));
    const dimH = `<text x="${(X(fl) + X(fh)) / 2}" y="${H - 8}" font-size="11" text-anchor="middle" fill="#14232a">${hLabel}: ${fh[axH] - fl[axH]} in</text>`;
    const dimV = `<text x="10" y="${H / 2}" font-size="11" text-anchor="middle" fill="#14232a" transform="rotate(-90 10 ${H / 2})">${vLabel}: ${fh[axV] - fl[axV]} in</text>`;
    return `<figure><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="#fff" stroke="#d2dde0"/>${pipes}${parts}${dimH}${dimV}</svg><figcaption>${title}</figcaption></figure>`;
  }

  function cutList(d) {
    const J = Design.joints(d);
    const hasFit = pt => { const j = J.get(Design.key(pt)); return j && (j.dirs.length > 1 || d.sealed); };
    const take = 0.5; // ½" sch 40 fittings: pipe goes about ½" past the center line into the socket... cut short of center by this
    const groups = {};
    d.pipes.forEach(p => {
      const cc = Math.round(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) * 2) / 2;
      const cut = cc - (hasFit(p.a) ? take : 0) - (hasFit(p.b) ? take : 0);
      const k = cc + '|' + cut;
      groups[k] = groups[k] || { cc, cut, n: 0 }; groups[k].n++;
    });
    return Object.values(groups).sort((a, b) => b.cc - a.cc);
  }

  function where(p, lo) {
    const [x, y, z] = p.at;
    const lr = Math.abs(x) < 0.5 ? 'centered side to side' : `${Math.abs(x)} in ${x < 0 ? 'left' : 'right'} of center`;
    const fb = Math.abs(z) < 0.5 ? 'halfway front to back' : `${Math.abs(z)} in toward the ${z < 0 ? 'front' : 'back'}`;
    return `${lr}, ${fb}, ${(y - lo).toFixed(1).replace('.0', '')} in above the bottom pipes`;
  }

  function wiringSvg(d) {
    const E = d.elec, O = k => ELECTRICAL[k].options[E[k]];
    const motors = d.parts.filter(p => PARTS[p.type] && (PARTS[p.type].kind === 'thruster' || p.type === 'claw'));
    const rowH = 30, y0 = 24, n = Math.max(1, motors.length), H = Math.max(130, y0 + n * rowH + 40), W = 780;
    const short = t => t.split(' (')[0].split(' ').slice(0, 3).join(' ');
    const box = (x, y, w, h, t1, t2, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill || '#f3f7f8'}" stroke="#14232a" stroke-width="1.5"/>` +
      (t2 ? `<text x="${x + w / 2}" y="${y + h / 2 - 3}" font-size="12" font-weight="700" text-anchor="middle">${esc(t1)}</text><text x="${x + w / 2}" y="${y + h / 2 + 12}" font-size="10.5" text-anchor="middle" fill="#40525a">${esc(t2)}</text>`
        : `<text x="${x + w / 2}" y="${y + h / 2 + 4}" font-size="11.5" font-weight="700" text-anchor="middle">${esc(t1)}</text>`);
    const wire = (x1, x2, y) => `<line x1="${x1}" y1="${y - 2.5}" x2="${x2}" y2="${y - 2.5}" stroke="#d6332e" stroke-width="2.5"/><line x1="${x1}" y1="${y + 2.5}" x2="${x2}" y2="${y + 2.5}" stroke="#14232a" stroke-width="2.5"/>`;
    const mid = y0 + n * rowH / 2;
    let s = wire(110, 140, mid) + wire(240, 270, mid) + wire(380, 410, mid);
    s += box(10, mid - 28, 100, 56, '12 V battery', short(O('battery').name), '#fff1d1');
    s += box(140, mid - 24, 100, 48, `${O('fuse').amps > 100 ? 'NO' : O('fuse').amps + ' A'} fuse`, O('fuseDist').name.split(' from')[0]);
    s += box(270, mid - 24, 110, 48, 'Connector', O('connector').name.split(' ').slice(0, 2).join(' '));
    s += `<rect x="548" y="${y0 - 6}" width="74" height="${n * rowH + 2}" rx="8" fill="#eef7e0" stroke="#8cc63f" stroke-dasharray="4 3"/><text x="585" y="${y0 + n * rowH + 14}" font-size="11" font-weight="700" text-anchor="middle">Tether</text><text x="585" y="${y0 + n * rowH + 27}" font-size="10.5" text-anchor="middle" fill="#40525a">${esc(short(O('gauge').name))}, ${O('tether').ft} ft</text>`;
    motors.forEach((p, i) => { const y = y0 + i * rowH + rowH / 2 - 4; s += wire(530, 650, y) + box(650, y - 12, 120, 24, `M${i + 1} · ${PARTS[p.type].short}`); });
    s += box(410, mid - 34, 120, 68, 'Control box', `${motors.length} ${E.control === 'pwm' ? 'speed controls' : 'DPDT switches'}`, '#d9f0f2');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px"><style>text{font-family:Segoe UI,system-ui,sans-serif}</style>${s}<text x="10" y="${H - 6}" font-size="11" fill="#40525a">Red = positive, black = negative. One wire pair per motor runs through the tether.</text></svg>`;
  }

  function shopSheet(d, team, rov, o) {
    o = o || {};
    const ins = Design.inspect(d), B = ins.budget, mp = Design.massProps(d), b = Design.bounds(d);
    const lo = Math.min(...d.pipes.flatMap(p => [p.a[1], p.b[1]]));
    const fc = {}; Design.fittings(d).forEach(f => fc[f.type] = (fc[f.type] || 0) + 1);
    const cuts = cutList(d);
    const totalIn = Design.pipeInches(d);
    const E = d.elec, O = k => ELECTRICAL[k].options[E[k]];
    const css = `body{font-family:Segoe UI,system-ui,sans-serif;max-width:900px;margin:20px auto;padding:0 16px;color:#14232a;line-height:1.45;font-size:14px}
      h1{margin:0;font-size:24px}h2{font-size:17px;margin:22px 0 6px;border-bottom:2px solid #007c8a;padding-bottom:3px;break-after:avoid}
      table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #c9d6da;padding:4px 7px;text-align:left;vertical-align:top}th{background:#eef4f5}
      .views{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0}figcaption{font-size:12px;color:#586a72;text-align:center}
      .meta{color:#586a72}.box{display:inline-block;width:13px;height:13px;border:1.5px solid #14232a;vertical-align:-2px;margin-right:6px}
      .warn{color:#b4441b;font-weight:600}.print{float:right;padding:6px 12px}@media print{.print{display:none}section{break-inside:avoid}}`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Shop sheet: ${esc(rov)}</title><style>${css}</style></head><body>
      ${o.embed ? '' : '<button class="print" onclick="window.print()">Print</button>'}
      <h1>Shop sheet: ${esc(rov)}</h1>
      <p class="meta">Team: ${esc(team || '—')} · Underwater IVD 2026–27 · made ${new Date().toLocaleDateString()}</p>
      <p>Size ${b.size.map(v => Math.round(v)).join(' × ')} in (W × H × L) · ${Math.round(mp.M)} g in air · net buoyancy ${Math.round(mp.net) >= 0 ? '+' : ''}${Math.round(mp.net)} g in fresh water · build cost ${fmt$(B.total)}</p>
      ${ins.ok ? '' : `<p class="warn">This design does not pass inspection yet: ${ins.items.filter(i => !i.pass && i.kind !== 'warn').map(i => esc(i.id)).join(', ')}.</p>`}
      <section><h2>1. Drawings</h2><p>Numbers match the parts list in section 3. Front of the ROV is at the top of the top view.</p><div class="views">
        ${orthoSvg(d, 0, 2, true, 'Top view (looking down)', 'Width', 'Length')}${orthoSvg(d, 2, 1, false, 'Side view (front on the left)', 'Length', 'Height')}${orthoSvg(d, 0, 1, false, 'Front view', 'Width', 'Height')}</div></section>
      <section><h2>2. Cut list: ½" schedule 40 PVC</h2>
        <p>${Math.round(totalIn)} in total from ${Math.ceil(totalIn / 120)} × 10 ft stick${Math.ceil(totalIn / 120) === 1 ? '' : 's'}. Cut lengths allow about ½" at each end that goes into a fitting. <b>Dry-fit the whole frame before gluing.</b> ${d.sealed ? 'Sealed frame: prime and cement every joint and cap every open end.' : 'Flooded frame: drill a few ¼" holes in every pipe so water fills it, and leave ends open or drilled.'}</p>
        <table><tr><th>Qty</th><th>Center-to-center</th><th>Cut length</th><th>Done</th></tr>${cuts.map(c => `<tr><td>${c.n}</td><td>${c.cc} in</td><td><b>${c.cut} in</b></td><td><span class="box"></span></td></tr>`).join('')}</table>
        <table style="margin-top:8px"><tr><th>Fitting</th><th>Qty</th></tr>${Object.keys(FITTINGS).filter(k => fc[k]).map(k => `<tr><td>${FITTINGS[k].name}</td><td>${fc[k]}</td></tr>`).join('')}</table></section>
      <section><h2>3. Parts and where they go</h2><p>Positions are measured from the center of the frame. Zip-tie or hose-clamp each part to the nearest pipe.</p>
        <table><tr><th>#</th><th>Part</th><th>Where</th><th>Points / pushes</th></tr>${d.parts.map((p, i) => { const P = PARTS[p.type]; if (!P) return ''; const dir = P.kind === 'camera' ? `tilted ${p.tilt || 0}°` : P.kind === 'weight' ? `qty ${p.qty || 1}` : P.tool === 'ruler' ? 'across the front' : (P.kind === 'thruster' ? 'pushes ' : P.kind === 'float' ? 'lies ' : 'points ') + DIRS[p.dir].label.toLowerCase(); return `<tr><td>${i + 1}</td><td>${esc(P.name)}</td><td>${where(p, lo)}</td><td>${dir}</td></tr>`; }).join('')}</table></section>
      <section><h2>4. Wiring</h2>${wiringSvg(d)}
        <ul><li>Battery: ${esc(O('battery').name)} (rules 6.1, 6.2: no batteries on the ROV).</li><li>Fuse: ${esc(O('fuse').name)}, ${esc(O('fuseDist').name)}, before any other device (rule 6.9).</li>
        <li>Battery connection: ${esc(O('connector').name)} (rule 6.8).</li><li>Connections: ${esc(O('splice').name)}, no bare wire more than 0.5 cm from a terminal (rules 7.1, 7.2).</li>
        <li>Motor and tether wire: ${esc(O('gauge').name)}, ${esc(O('tether').name)} (rule 7.6).</li><li>Control box: ${esc(O('control').name)}. Label each switch with its motor number.</li>
        <li>Full-power current: ${Design.fullPowerAmps(d).toFixed(1)} A.</li></ul></section>
      <section><h2>5. Shopping list</h2><table><tr><th>Budget line</th><th>Item</th><th>Qty</th><th>Each</th><th>Total</th></tr>${B.rows.map(r => `<tr><td>${esc(r.line)}</td><td>${esc(r.desc)}</td><td>${r.qty}</td><td>${fmt$(r.each)}</td><td>${fmt$(r.total)}</td></tr>`).join('')}
        <tr><th colspan="4">Build total (limit $2,000)</th><th>${fmt$(B.total)}</th></tr></table><p class="meta">Prices are typical estimates. Check real Amazon prices for your budget report (rule 2.3).</p></section>
      <section><h2>6. Inspection checklist</h2><table><tr><th></th><th>Rule</th><th>Check on the real ROV</th></tr>${ins.items.filter(i => i.kind !== 'build' && i.kind !== 'warn').map(i => `<tr><td><span class="box"></span></td><td>${esc(i.id)}</td><td>${esc(i.text)}</td></tr>`).join('')}
        <tr><td><span class="box"></span></td><td>5.2</td><td>Everyone wears safety glasses when working on or driving the ROV</td></tr></table></section>
      </body></html>`;
  }

  /* ---------- heat replay ---------- */
  function trackAt(track, t) {
    if (!track.length) return null;
    let i = 0; while (i < track.length - 1 && track[i + 1][0] / 10 <= t) i++;
    const a = track[i], b = track[Math.min(track.length - 1, i + 1)];
    const f = b[0] === a[0] ? 0 : Math.max(0, Math.min(1, (t - a[0] / 10) / ((b[0] - a[0]) / 10)));
    return { x: (a[1] + (b[1] - a[1]) * f) / 100, z: (a[2] + (b[2] - a[2]) * f) / 100, depth: (a[3] + (b[3] - a[3]) * f) / 100, hdg: a[4] };
  }

  function replayStats(rec) {
    const tr = rec.track;
    let dist = 0, under = 0;
    for (let i = 1; i < tr.length; i++) {
      dist += Math.hypot(tr[i][1] - tr[i - 1][1], tr[i][2] - tr[i - 1][2]) / 100;
      if (tr[i][3] > 30) under += (tr[i][0] - tr[i - 1][0]) / 10;
    }
    const dur = tr.length ? tr[tr.length - 1][0] / 10 : 0;
    const scoring = rec.events.filter(e => e.cls === 'good' && !/started|over/i.test(e.msg)).map(e => e.t);
    let gap = 0, last = 0;
    scoring.concat([dur]).forEach(t => { gap = Math.max(gap, t - last); last = t; });
    return { dist, dur, under, avg: dur ? dist / dur : 0, firstScore: scoring.length ? scoring[0] : null, longestGap: gap, scores: scoring.length };
  }

  function drawReplay(cv, rec, pool, t) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const pad = 20;
    const sc = Math.min((W - 2 * pad) / (pool.x1 - pool.x0), (H - 2 * pad) / (pool.z1 - pool.z0));
    const ox = W / 2 - (pool.x0 + pool.x1) / 2 * sc, oz = pad - pool.z0 * sc;
    const X = x => ox + x * sc, Z = z => oz + z * sc;
    g.fillStyle = '#9fd3e3'; g.fillRect(X(pool.x0), Z(pool.z0), (pool.x1 - pool.x0) * sc, (pool.z1 - pool.z0) * sc);
    g.strokeStyle = '#0d4a5a'; g.lineWidth = 2; g.strokeRect(X(pool.x0), Z(pool.z0), (pool.x1 - pool.x0) * sc, (pool.z1 - pool.z0) * sc);
    g.fillStyle = '#5c9a1f'; g.fillRect(X(rec.start.x) - 14, Z(pool.z1) - 7, 28, 7);
    g.font = '600 12px Segoe UI, sans-serif'; g.fillStyle = '#0d4a5a'; g.textAlign = 'center'; g.fillText('START', X(rec.start.x), Z(pool.z1) - 10);
    (rec.items || []).forEach(it => {
      if (it.t === 'ring') { g.strokeStyle = it.c; g.lineWidth = 3; g.beginPath(); g.arc(X(it.x), Z(it.z), 5, 0, 7); g.stroke(); }
      if (it.t === 'tip') { g.strokeStyle = '#ffffff'; g.lineWidth = 2.5; g.strokeRect(X(it.x) - 0.23 * sc, Z(it.z) - 0.17 * sc, 0.46 * sc, 0.33 * sc); }
      if (it.t === 'hoop') { g.strokeStyle = '#2f8f3a'; g.lineWidth = 4; g.beginPath(); g.moveTo(X(it.x) - 10, Z(it.z)); g.lineTo(X(it.x) + 10, Z(it.z)); g.stroke(); }
      if (it.t === 'reef') { g.strokeStyle = '#7b5cc4'; g.lineWidth = 4; g.beginPath(); g.moveTo(X(it.x) - 12, Z(it.z)); g.lineTo(X(it.x) + 12, Z(it.z)); g.moveTo(X(it.x), Z(it.z) - 12); g.lineTo(X(it.x), Z(it.z) + 12); g.stroke(); }
    });
    // path so far, fading from blue (start) to orange (now)
    const tr = rec.track.filter(p => p[0] / 10 <= t);
    for (let i = 1; i < tr.length; i++) {
      const f = i / Math.max(1, rec.track.length);
      g.strokeStyle = `hsl(${200 - f * 170}, 80%, ${tr[i][3] > 30 ? 35 : 55}%)`;
      g.lineWidth = tr[i][3] > 30 ? 3 : 1.5;
      g.beginPath(); g.moveTo(X(tr[i - 1][1] / 100), Z(tr[i - 1][2] / 100)); g.lineTo(X(tr[i][1] / 100), Z(tr[i][2] / 100)); g.stroke();
    }
    // event markers
    rec.events.forEach((e, i) => {
      if (e.t > t) return;
      const p = trackAt(rec.track, e.t); if (!p) return;
      g.fillStyle = e.cls === 'bad' ? '#d6332e' : e.cls === 'good' ? '#2a8a3a' : '#586a72';
      g.beginPath(); g.arc(X(p.x), Z(p.z), 8, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.font = '700 10px Segoe UI, sans-serif'; g.fillText(String(i + 1), X(p.x), Z(p.z) + 3.5);
    });
    const now = trackAt(rec.track, t);
    if (now) {
      g.save(); g.translate(X(now.x), Z(now.z)); g.rotate(now.hdg * Math.PI / 180);
      g.fillStyle = '#ffd23f'; g.strokeStyle = '#14232a'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
    return now;
  }

  function drawDepthStrip(cv, rec, t) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const tr = rec.track; if (tr.length < 2) return;
    const dur = tr[tr.length - 1][0] / 10, maxD = Math.max(100, ...tr.map(p => p[3]));
    g.fillStyle = 'rgba(27,127,209,.18)'; g.beginPath(); g.moveTo(0, 0);
    tr.forEach(p => g.lineTo(p[0] / 10 / dur * W, p[3] / maxD * (H - 6)));
    g.lineTo(W, 0); g.closePath(); g.fill();
    g.strokeStyle = '#1b7fd1'; g.lineWidth = 1.5; g.beginPath();
    tr.forEach((p, i) => { const x = p[0] / 10 / dur * W, y = p[3] / maxD * (H - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    rec.events.forEach(e => { g.fillStyle = e.cls === 'bad' ? '#d6332e' : e.cls === 'good' ? '#2a8a3a' : '#8a9aa0'; g.fillRect(e.t / dur * W - 1, 0, 2, H); });
    g.fillStyle = '#14232a'; g.fillRect(t / dur * W - 1, 0, 2, H);
  }

  U.Extras = { designHash, designStats, changeSummary, journalHtml, shopSheet, cutList, replayStats, drawReplay, drawDepthStrip, trackAt, mmss };
})();
