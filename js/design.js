/* ROV design model: frame pipes on a 1-inch grid plus attached parts.
   Body axes: x = right, y = up, z = back (forward is −z). Coordinates in inches. */
(function () {
  const U = window.UIVD;
  const { IN, PIPE, FITTINGS, PARTS, ELECTRICAL, DIRS } = U;

  const key = p => p.join(',');
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = v => Math.hypot(v[0], v[1], v[2]);
  let uidN = 1;
  const uid = () => 'p' + Date.now().toString(36) + (uidN++);

  function blank(name) {
    return { v: 1, name: name || 'My ROV', sealed: false, pipes: [], parts: [], elec: Object.assign({}, U.DEFAULT_ELECTRICAL), selfCheck: {} };
  }

  function box(x0, x1, y0, y1, z0, z1) {
    const P = [];
    const r = (a, b) => P.push({ a, b });
    for (const y of [y0, y1]) {
      r([x0, y, z0], [x1, y, z0]); r([x0, y, z1], [x1, y, z1]);
      r([x0, y, z0], [x0, y, z1]); r([x1, y, z0], [x1, y, z1]);
    }
    for (const x of [x0, x1]) for (const z of [z0, z1]) r([x, y0, z], [x, y1, z]);
    return P;
  }

  const PRESETS = {
    starter: {
      label: 'Starter ROV (workshop style)',
      make() {
        const d = blank('Starter ROV');
        setBox(d, { w: 12, h: 8, l: 14, top: true, bottom: false, mid: false, post: true });
        const P = (type, at, dir, extra) => d.parts.push(Object.assign({ id: uid(), type, at, dir }, extra || {}));
        P('gph500', [-7.5, 4, 7], 'fwd');
        P('gph500', [7.5, 4, 7], 'fwd');
        P('gph500', [0, 8, 0], 'down');
        P('fishcam', [0, 7, -8], 'fwd', { tilt: -20 });
        P('noodle6', [-6, 9.5, 2], 'back');
        P('noodle6', [6, 9.5, 2], 'back');
        P('washer', [0, 0, 7], 'fwd', { qty: 4 });
        P('prong12', [0, 4, -7], 'fwd');
        normalize(d);
        return d;
      }
    },
    flagbot: {
      label: 'Strafing ROV (4 motors, claw)',
      make() {
        const d = blank('Strafing ROV');
        setBox(d, { w: 14, h: 8, l: 16, top: true, bottom: true, mid: false, post: true });
        const P = (type, at, dir, extra) => d.parts.push(Object.assign({ id: uid(), type, at, dir }, extra || {}));
        P('gph750', [-8.5, 4, 8], 'fwd');
        P('gph750', [8.5, 4, 8], 'fwd');
        P('gph750', [0, 8, 0], 'down');
        P('gph500', [0, 0, 0], 'right');
        P('fishcam', [0, 7, -9], 'fwd', { tilt: -25 });
        P('fishcam2', [0, 1, -9], 'fwd', { tilt: -60 });
        P('noodle12', [-7, 9.5, 0], 'back');
        P('noodle12', [7, 9.5, 0], 'back');
        P('claw', [0, 4, -8], 'fwd');
        P('fork', [-5, 8, -8], 'fwd');
        normalize(d);
        trimToNeutral(d, 40, [[-7, 0, 1], [7, 0, 1]]);
        return d;
      }
    },
    racer: {
      label: 'Drag racer (compact, 4 × 1100 GPH)',
      make() {
        const d = blank('Drag Racer');
        setBox(d, { w: 10, h: 6, l: 18, top: true, bottom: true, mid: false });
        const P = (type, at, dir, extra) => d.parts.push(Object.assign({ id: uid(), type, at, dir }, extra || {}));
        P('gph1100', [-6.5, 1, 4], 'fwd'); P('gph1100', [6.5, 1, 4], 'fwd');
        P('gph1100', [-6.5, 5, 4], 'fwd'); P('gph1100', [6.5, 5, 4], 'fwd');
        P('gph500', [0, 6, 0], 'up');
        P('noodle12', [-5, 7.5, 0], 'back'); P('noodle12', [5, 7.5, 0], 'back');
        normalize(d);
        trimToNeutral(d, 10, [[-5, 0, -3], [5, 0, -3]]);
        return d;
      }
    },
    empty: { label: 'Empty frame (start from scratch)', make() { const d = blank('My ROV'); setBox(d, { w: 12, h: 8, l: 14, top: false, bottom: false, mid: false }); return d; } }
  };

  /* Box frame from simple dimensions (inches). Widths and lengths are kept even so the frame stays centered on the grid. */
  function boxPipes(B) {
    const w2 = Math.round(B.w / 2), l2 = Math.round(B.l / 2), h = Math.round(B.h);
    const P = box(-w2, w2, 0, h, -l2, l2);
    if (B.top) P.push({ a: [-w2, h, 0], b: [w2, h, 0] });
    if (B.bottom) P.push({ a: [-w2, 0, 0], b: [w2, 0, 0] });
    if (B.mid) { const m = Math.round(h / 2); P.push({ a: [-w2, m, -l2], b: [-w2, m, l2] }, { a: [w2, m, -l2], b: [w2, m, l2] }); }
    if (B.post) P.push({ a: [0, 0, -l2], b: [0, h, -l2] }); // front center post for mounting tools
    return P;
  }
  function setBox(d, B) { d.box = Object.assign({}, B); d.pipes = boxPipes(B); normalize(d); }

  // Change the box size and carry every part along: each part keeps its offset from the nearest pipe.
  function resizeBox(d, B) {
    const old = d.box;
    const anchors = d.parts.map(p => { const n = nearestOnFrame(d, p.at); return { p, n: n.p, off: [p.at[0] - n.p[0], p.at[1] - n.p[1], p.at[2] - n.p[2]] }; });
    setBox(d, B);
    if (!old) return;
    const sx = B.w / old.w, sy = B.h / old.h, sz = B.l / old.l;
    const r = v => Math.round(v * 2) / 2;
    anchors.forEach(a => {
      const np = [a.n[0] * sx, a.n[1] * sy, a.n[2] * sz];
      const snapped = nearestOnFrame(d, np).p;
      a.p.at = [r(snapped[0] + a.off[0]), r(snapped[1] + a.off[1]), r(snapped[2] + a.off[2])];
    });
  }

  function nearestOnFrame(d, pt) {
    let best = { dist: Infinity, p: pt.slice(), pipe: -1 };
    d.pipes.forEach((p, i) => {
      const ab = sub(p.b, p.a), ap = sub(pt, p.a);
      const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / L2));
      const c = [p.a[0] + ab[0] * t, p.a[1] + ab[1] * t, p.a[2] + ab[2] * t];
      const dd = len(sub(pt, c));
      if (dd < best.dist) best = { dist: dd, p: c, pipe: i };
    });
    return best;
  }

  /* Keep the frame tidy: split pipes where another pipe ends in their middle, drop zero-length and duplicates. */
  function normalize(d) {
    let changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      const ends = new Map();
      d.pipes.forEach(p => { ends.set(key(p.a), p.a); ends.set(key(p.b), p.b); });
      for (let i = 0; i < d.pipes.length && !changed; i++) {
        const p = d.pipes[i];
        for (const e of ends.values()) {
          if (eq(e, p.a) || eq(e, p.b)) continue;
          if (onSegment(e, p.a, p.b)) { d.pipes.splice(i, 1, { a: p.a, b: e }, { a: e, b: p.b }); changed = true; break; }
        }
      }
    }
    const seen = new Set();
    d.pipes = d.pipes.filter(p => {
      if (eq(p.a, p.b)) return false;
      const k = [key(p.a), key(p.b)].sort().join('|');
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    return d;
  }

  function onSegment(e, a, b) {
    const ab = sub(b, a), ae = sub(e, a);
    const L = len(ab);
    const t = (ab[0] * ae[0] + ab[1] * ae[1] + ab[2] * ae[2]) / (L * L);
    if (t <= 0 || t >= 1) return false;
    const c = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    return len(sub(c, e)) < 1e-6;
  }

  function overlaps(d, a, b) {
    const dir = sub(b, a).map(Math.sign);
    return d.pipes.some(p => {
      const pd = sub(p.b, p.a).map(Math.sign);
      const par = (pd[0] === dir[0] && pd[1] === dir[1] && pd[2] === dir[2]) || (pd[0] === -dir[0] && pd[1] === -dir[1] && pd[2] === -dir[2]);
      if (!par) return false;
      // same line?
      const axis = dir.findIndex(v => v !== 0);
      const others = [0, 1, 2].filter(i => i !== axis);
      if (others.some(i => p.a[i] !== a[i])) return false;
      const lo1 = Math.min(a[axis], b[axis]), hi1 = Math.max(a[axis], b[axis]);
      const lo2 = Math.min(p.a[axis], p.b[axis]), hi2 = Math.max(p.a[axis], p.b[axis]);
      return Math.min(hi1, hi2) - Math.max(lo1, lo2) > 0;
    });
  }

  function addPipe(d, a, dirKey, inches) {
    const v = DIRS[dirKey].v;
    const b = [a[0] + v[0] * inches, a[1] + v[1] * inches, a[2] + v[2] * inches];
    if (overlaps(d, a, b)) return { ok: false, msg: 'There is already a pipe there.' };
    d.pipes.push({ a: a.slice(), b });
    normalize(d);
    return { ok: true, end: b };
  }

  function removePipe(d, idx) {
    d.pipes.splice(idx, 1);
    // merge straight runs left behind by a removed side branch (two collinear pipes meeting at a joint with nothing else)
    let merged = true;
    while (merged) {
      merged = false;
      const conn = joints(d);
      for (const [k, j] of conn) {
        if (j.dirs.length === 2 && j.dirs[0].every((x, i) => x === -j.dirs[1][i])) {
          const [i1, i2] = j.pipes;
          const p1 = d.pipes[i1], p2 = d.pipes[i2];
          const far1 = eq(p1.a, j.p) ? p1.b : p1.a, far2 = eq(p2.a, j.p) ? p2.b : p2.a;
          d.pipes = d.pipes.filter((_, i) => i !== i1 && i !== i2);
          d.pipes.push({ a: far1, b: far2 });
          merged = true; break;
        }
      }
    }
  }

  function joints(d) {
    const m = new Map();
    d.pipes.forEach((p, i) => {
      for (const [e, o] of [[p.a, p.b], [p.b, p.a]]) {
        const k = key(e);
        if (!m.has(k)) m.set(k, { p: e, dirs: [], pipes: [] });
        const dv = sub(o, e).map(Math.sign);
        m.get(k).dirs.push(dv); m.get(k).pipes.push(i);
      }
    });
    return m;
  }

  function fittingFor(dirs, sealed) {
    const n = dirs.length;
    const collinear = (a, b) => a[0] === -b[0] && a[1] === -b[1] && a[2] === -b[2];
    if (n === 1) return sealed ? 'cap' : null;
    if (n === 2) return collinear(dirs[0], dirs[1]) ? 'coupling' : 'elbow';
    if (n === 3) {
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (collinear(dirs[i], dirs[j])) return 'tee';
      return 'corner3';
    }
    if (n === 4) {
      const axes = new Set(dirs.map(v => v.findIndex(x => x !== 0)));
      return axes.size === 2 ? 'cross' : 'side4';
    }
    return n === 5 ? 'way5' : 'way6';
  }

  function fittings(d) {
    const out = [];
    for (const [k, j] of joints(d)) {
      const f = fittingFor(j.dirs, d.sealed);
      if (f) out.push({ type: f, p: j.p, dirs: j.dirs });
    }
    return out;
  }

  function pipeInches(d) { return d.pipes.reduce((s, p) => s + len(sub(p.b, p.a)), 0); }

  function distToFrame(d, pt) {
    let best = Infinity;
    for (const p of d.pipes) {
      const ab = sub(p.b, p.a), ap = sub(pt, p.a);
      const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / L2));
      best = Math.min(best, len(sub(pt, [p.a[0] + ab[0] * t, p.a[1] + ab[1] * t, p.a[2] + ab[2] * t])));
    }
    return best;
  }

  function connected(d) {
    if (!d.pipes.length) return true;
    const J = joints(d), seen = new Set();
    const stack = [key(d.pipes[0].a)];
    while (stack.length) {
      const k = stack.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      J.get(k).pipes.forEach(i => { const p = d.pipes[i]; stack.push(key(p.a), key(p.b)); });
    }
    return seen.size === J.size;
  }

  /* Elements = little lumps of mass and volume used by the physics (buoyancy, gravity, contact). Positions in metres. */
  function elements(d) {
    const els = [];
    const m = v => v.map(x => x * IN);
    for (const p of d.pipes) {
      const L = len(sub(p.b, p.a));
      const n = Math.max(1, Math.round(L / 3));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, seg = L / n;
        const pos = [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t, p.a[2] + (p.b[2] - p.a[2]) * t];
        els.push({ pos: m(pos), g: PIPE.gPerIn * seg, cm3: PIPE.matCm3PerIn * seg + (d.sealed ? PIPE.airCm3PerIn * seg : 0), r: 0.011, src: 'pipe' });
      }
    }
    for (const f of fittings(d)) {
      const F = FITTINGS[f.type];
      els.push({ pos: m(f.p), g: F.g, cm3: F.cm3, r: 0.016, src: 'fit' });
    }
    for (const part of d.parts) {
      const P = PARTS[part.type]; if (!P) continue;
      const q = part.qty || 1;
      const c = partCenter(part);
      els.push({ pos: m(c), g: P.g * q, cm3: P.cm3 * q, r: Math.max(0.015, Math.min(0.06, Math.max(...P.size) / 3)), src: 'part', part });
      if (P.kind === 'tool' && P.tool !== 'ruler') {
        // put a second lump near the tip so long tools feel long
        const t = toolTip(part);
        els.push({ pos: m(t), g: 0, cm3: 0, r: 0.012, src: 'tip', part });
      }
      if (P.tool === 'ruler') {
        const half = P.len / 2 / IN;
        for (const sx of [-1, 1]) els.push({ pos: m([part.at[0] + sx * half, part.at[1], part.at[2]]), g: 0, cm3: 0, r: 0.01, src: 'tip', part });
      }
    }
    return els;
  }

  // Parts are drawn and weighed at their mount point; tools stick out from it.
  function partCenter(part) {
    const P = PARTS[part.type];
    if (P.kind === 'tool' && P.tool !== 'ruler') {
      const v = DIRS[part.dir || 'fwd'].v, h = P.tipLen / IN / 2;
      return [part.at[0] + v[0] * h, part.at[1] + v[1] * h, part.at[2] + v[2] * h];
    }
    return part.at;
  }
  function toolTip(part) {
    const P = PARTS[part.type], v = DIRS[part.dir || 'fwd'].v, h = (P.tipLen || 0) / IN;
    return [part.at[0] + v[0] * h, part.at[1] + v[1] * h, part.at[2] + v[2] * h];
  }

  function massProps(d) {
    const els = elements(d);
    let M = 0, V = 0; const cm = [0, 0, 0], cb = [0, 0, 0];
    for (const e of els) {
      M += e.g; V += e.cm3;
      for (let i = 0; i < 3; i++) { cm[i] += e.pos[i] * e.g; cb[i] += e.pos[i] * e.cm3; }
    }
    for (let i = 0; i < 3; i++) { cm[i] /= M || 1; cb[i] /= V || 1; }
    const net = V - M; // grams of lift in fresh water (positive floats)
    const sep = cb[1] - cm[1]; // metres, CoB above CoM is stable
    const pitch = sep > 0.001 ? Math.atan2(-(cb[2] - cm[2]) * V, sep * V) * 180 / Math.PI : null;
    const roll = sep > 0.001 ? Math.atan2((cb[0] - cm[0]), sep) * 180 / Math.PI : null;
    return { els, M, V, cm, cb, net, sep, pitch, roll };
  }

  function bounds(d) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const add = (p, r) => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i] - r); hi[i] = Math.max(hi[i], p[i] + r); } };
    d.pipes.forEach(p => { add(p.a, 0.42); add(p.b, 0.42); });
    d.parts.forEach(part => {
      const P = PARTS[part.type]; if (!P) return;
      if (P.tool === 'ruler') { add([part.at[0] - P.len / 2 / IN, part.at[1], part.at[2]], 0.6); add([part.at[0] + P.len / 2 / IN, part.at[1], part.at[2]], 0.6); return; }
      add(part.at, Math.max(P.size[0], P.size[1]) / 2 / IN);
      if (P.kind === 'tool') add(toolTip(part), 0.5);
      else if (P.kind === 'thruster' || P.kind === 'float') {
        const v = DIRS[part.dir || 'fwd'].v, h = P.size[2] / 2 / IN;
        add([part.at[0] + v[0] * h, part.at[1] + v[1] * h, part.at[2] + v[2] * h], P.size[0] / 2 / IN);
        add([part.at[0] - v[0] * h, part.at[1] - v[1] * h, part.at[2] - v[2] * h], P.size[0] / 2 / IN);
      }
    });
    if (lo[0] === Infinity) return { lo: [0, 0, 0], hi: [0, 0, 0], size: [0, 0, 0] };
    return { lo, hi, size: hi.map((h, i) => h - lo[i]) };
  }

  /* Bill of materials, grouped by the Square One budget lines. */
  function bom(d) {
    const rows = [];
    const add = (line, desc, qty, each, note) => { if (qty > 0) rows.push({ line, desc, qty, each, total: +(qty * each).toFixed(2), note: note || '' }); };
    const inches = pipeInches(d);
    const sticks = Math.ceil(inches / PIPE.stickIn);
    add('PVC Tube & Fittings', '½" sch 40 PVC pipe, 10 ft stick', sticks, PIPE.stickPrice, `${Math.round(inches)} in used (center to center)`);
    const fc = {};
    fittings(d).forEach(f => { fc[f.type] = (fc[f.type] || 0) + 1; });
    Object.keys(FITTINGS).forEach(t => fc[t] && add('PVC Tube & Fittings', FITTINGS[t].name, fc[t], FITTINGS[t].price));
    if (d.sealed) add('Misc Hardware', 'PVC primer + cement (sealed frame)', 1, 9.98);
    const pc = {};
    d.parts.forEach(p => { pc[p.type] = (pc[p.type] || 0) + (p.qty || 1); });
    Object.keys(pc).forEach(t => { const P = PARTS[t]; if (P) add(P.budget, P.name, pc[t], P.price); });
    const motors = d.parts.filter(p => PARTS[p.type] && PARTS[p.type].kind === 'thruster').length;
    const claws = d.parts.filter(p => p.type === 'claw').length;
    const E = d.elec, O = k => ELECTRICAL[k].options[E[k]];
    if (motors) add('Misc Hardware', 'Motor waterproofing (wax ring + marine epoxy)', motors, 5.49, 'per motor');
    add('Batteries', O('battery').name, 1, O('battery').price);
    add('Wire, Switches & Connectors', O('connector').name, 1, O('connector').price);
    add('Wire, Switches & Connectors', O('fuse').name + ' + holder', O('fuse').price ? 1 : 0, O('fuse').price);
    add('Wire, Switches & Connectors', O('splice').name + ' kit', 1, O('splice').price);
    const pairs = motors + claws;
    const ft = O('tether').ft + 3;
    add('Wire, Switches & Connectors', `${O('gauge').name.split(' (')[0]} 2-conductor wire (one pair per motor)`, Math.round(pairs * ft), O('gauge').perFt, `${pairs} pairs × ${ft} ft`);
    const C = O('control');
    add('Wire, Switches & Connectors', C.name.split(' (')[0] + ' (one per motor)', pairs, C.perMotor);
    add('Other Electronics', 'Control box enclosure, panel, labels', 1, C.box);
    add('Material Stock', O('tetherFloat').name, O('tetherFloat').price ? 1 : 0, O('tetherFloat').price);
    add('Misc Hardware', 'Zip ties, hose clamps, stainless fasteners', 1, 7.99);
    const total = +rows.reduce((s, r) => s + r.total, 0).toFixed(2);
    const byLine = {};
    U.BUDGET_LINES.forEach(l => byLine[l] = 0);
    rows.forEach(r => byLine[r.line] = +(byLine[r.line] + r.total).toFixed(2));
    return { rows, total, byLine };
  }

  function fullPowerAmps(d) {
    return d.parts.reduce((s, p) => { const P = PARTS[p.type]; return s + (P && P.amps ? P.amps : 0); }, 0);
  }

  /* Vehicle inspection, following the 2027 inspection form plus build checks. */
  function inspect(d) {
    const E = d.elec, items = [];
    const opt = k => ELECTRICAL[k].options[E[k]];
    const it = (id, text, pass, why, kind) => items.push({ id, text, pass, why: pass ? '' : why, kind: kind || 'rule' });
    it('5.4', 'No pressure tanks or accumulators', true);
    it('5.5', 'No fluids other than water', true);
    it('6.1', '12 V lead acid battery in a protective case', opt('battery').pass || E.battery === 'onboard', opt('battery').why);
    it('6.2', 'No batteries on the ROV', E.battery !== 'onboard', ELECTRICAL.battery.options.onboard.why);
    it('6.8', 'Reliable battery connection (no bare wire in clamps)', opt('connector').pass, opt('connector').why);
    it('6.9', '25 A (max) fuse within 30 cm of the battery', opt('fuse').pass && opt('fuseDist').pass, opt('fuse').why || opt('fuseDist').why);
    it('6.10', 'No 110 V devices on the pool deck', opt('display').pass, opt('display').why);
    it('7.1', 'Mechanical wire connections with heat shrink', opt('splice').pass, opt('splice').why);
    it('7.2', 'No bare wire except within 0.5 cm of a terminal', opt('splice').pass, 'Rule 7.2: taped splices leave bare wire. Use heat shrink.');
    it('7.4', 'Terminals secured so they cannot loosen or short', !!d.selfCheck['7.4'], 'Tick this once your team has checked every terminal.', 'self');
    it('7.5', 'Grommets where wire passes through sharp holes', !!d.selfCheck['7.5'], 'Tick this once your team has checked every hole.', 'self');
    it('7.6', 'Motor wiring is 14 gauge or larger', opt('gauge').pass, opt('gauge').why);
    const B = bom(d);
    it('2.1', `Build budget under $2,000 (now $${B.total.toFixed(2)})`, B.total <= U.BUILD_BUDGET, 'Rule 2.1: the ROV must cost $2,000 or less at full retail price.', 'build');
    const loose = d.parts.filter(p => distToFrame(d, partCenter(p)) > 3.2 && distToFrame(d, p.at) > 3.2);
    it('B1', 'Every part is fastened to the frame', loose.length === 0, `${loose.length} part${loose.length === 1 ? ' is' : 's are'} more than 3 in from any pipe. Move ${loose.length === 1 ? 'it' : 'them'} next to the frame so you can zip-tie ${loose.length === 1 ? 'it' : 'them'}.`, 'build');
    it('B2', 'The frame is one connected piece', connected(d), 'Some pipes are not joined to the rest of the frame.', 'build');
    const thr = d.parts.filter(p => PARTS[p.type] && PARTS[p.type].kind === 'thruster');
    it('B3', 'At least one camera (not needed for the drag racer)', d.parts.some(p => PARTS[p.type] && PARTS[p.type].kind === 'camera'), 'Add a camera. The pilot may not look at the pool during a heat.', 'warn');
    it('B4', 'Has thrusters for driving and diving', thr.some(p => ['fwd', 'back'].includes(p.dir)) && thr.some(p => ['up', 'down'].includes(p.dir)), 'Add at least one forward thruster and one vertical thruster.', 'build');
    const amps = fullPowerAmps(d), fuseA = opt('fuse').amps;
    it('W1', `Full-power current ${amps.toFixed(1)} A fits the ${fuseA > 100 ? 'missing' : fuseA + ' A'} fuse`, amps <= fuseA, `If every motor runs at once, the fuse will blow. Use fewer or smaller motors, or don't run them all together.`, 'warn');
    const ok = items.filter(i => i.kind !== 'warn').every(i => i.pass);
    return { items, ok, budget: B };
  }

  // Add ballast at the given spots until the ROV is about targetGrams buoyant. Uses ½ lb weights, then washers.
  function trimToNeutral(d, targetGrams, spots) {
    let extra = massProps(d).net - targetGrams;
    const sink = t => PARTS[t].g - PARTS[t].cm3;
    const per = spots.length;
    const big = Math.floor(extra / (sink('sinker') * per));
    if (big > 0) { spots.forEach(at => d.parts.push({ id: uid(), type: 'sinker', at, dir: 'fwd', qty: big })); extra -= big * per * sink('sinker'); }
    const small = Math.round(extra / (sink('washer') * per));
    if (small > 0) spots.forEach(at => d.parts.push({ id: uid(), type: 'washer', at, dir: 'fwd', qty: Math.min(12, small) }));
  }

  function clone(d) { return JSON.parse(JSON.stringify(d)); }

  function validate(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.pipes) || !Array.isArray(obj.parts)) return null;
    const d = blank(String(obj.name || 'My ROV').slice(0, 60));
    d.sealed = !!obj.sealed;
    const num = x => Number.isFinite(+x) ? Math.round(+x * 2) / 2 : 0;
    d.pipes = obj.pipes.filter(p => p && p.a && p.b).slice(0, 400).map(p => ({ a: p.a.slice(0, 3).map(num), b: p.b.slice(0, 3).map(num) }));
    d.parts = obj.parts.filter(p => p && PARTS[p.type]).slice(0, 80).map(p => ({ id: uid(), type: p.type, at: (p.at || [0, 0, 0]).slice(0, 3).map(num), dir: DIRS[p.dir] ? p.dir : 'fwd', tilt: Math.max(-90, Math.min(30, +p.tilt || 0)), qty: Math.max(1, Math.min(12, Math.round(+p.qty || 1))) }));
    if (obj.elec) for (const k in ELECTRICAL) if (ELECTRICAL[k].options[obj.elec[k]]) d.elec[k] = obj.elec[k];
    if (obj.box && ['w', 'h', 'l'].every(k => Number.isFinite(+obj.box[k]))) d.box = { w: Math.max(6, Math.min(24, Math.round(+obj.box.w / 2) * 2)), h: Math.max(4, Math.min(16, Math.round(+obj.box.h))), l: Math.max(6, Math.min(28, Math.round(+obj.box.l / 2) * 2)), top: !!obj.box.top, bottom: !!obj.box.bottom, mid: !!obj.box.mid, post: !!obj.box.post };
    if (obj.selfCheck) d.selfCheck = { '7.4': !!obj.selfCheck['7.4'], '7.5': !!obj.selfCheck['7.5'] };
    normalize(d);
    return d;
  }

  Object.assign(U, { Design: { blank, PRESETS, boxPipes, setBox, resizeBox, nearestOnFrame, normalize, addPipe, removePipe, joints, fittings, fittingFor, pipeInches, distToFrame, elements, partCenter, toolTip, massProps, bounds, bom, inspect, fullPowerAmps, clone, validate, uid, key, eq } });
})();
