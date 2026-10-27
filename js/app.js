/* Underwater IVD ROV Lab: UI, builder, pilot loop, heats, scoring, turn-in and the teacher view. */
(function () {
  const U = window.UIVD;
  const { IN, PARTS, CATS, ELECTRICAL, DIRS, Design, Physics, World, Missions, FITTINGS, Extras } = U;
  const { MISSIONS } = Missions;
  const $ = s => document.querySelector(s);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt$ = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const mmss = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = Math.floor(s % 60); return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0'); };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('uivd.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('uivd.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  };

  /* ---------------- state ---------------- */
  let design = Design.validate(store.get('design', null)) || Design.PRESETS.starter.make();
  let mode = 'build';
  let buildStep = store.get('buildStep', 'frame');
  let motorType = store.get('motorType', 'gph500');
  let pilotTab = 'mission';
  let sel = null; // {kind:'joint'|'pipe'|'part', p, i, id}
  let mirror = store.get('mirror', true);
  let pipeLen = store.get('pipeLen', 6);
  const opts = Object.assign({ sound: false, murky: false, touch: matchMedia('(pointer: coarse)').matches, balance: true, map: true, junior: false }, store.get('opts', {}));
  let progress = store.get('progress', {});
  let undoStack = [], redoStack = [];

  /* ---------------- toast, modal, downloads ---------------- */
  let toastT;
  function toast(msg) {
    let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function modal(title, html, actions, wide) {
    $('#mTitle').textContent = title;
    $('#mBody').innerHTML = html;
    const A = $('#mActions'); A.innerHTML = '';
    (actions || [{ label: 'Close' }]).forEach(a => {
      const b = document.createElement('button'); b.className = 'btn' + (a.cls ? ' ' + a.cls : ''); b.textContent = a.label;
      b.onclick = () => { if (!a.keep) closeModal(); a.run && a.run(); };
      A.appendChild(b);
    });
    $('.dialog').classList.toggle('wide', !!wide);
    $('#modal').hidden = false;
    setTimeout(() => { const f = A.querySelector('button:last-child'); f && f.focus(); }, 20);
  }
  function closeModal() { $('#modal').hidden = true; }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

  let dlNS;
  async function saveFile(filename, data) {
    try {
      if (dlNS === undefined) dlNS = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    } catch (e) { dlNS = null; }
    if (dlNS) {
      try { await dlNS.save({ filename, data }); toast('Saved ' + filename); return true; }
      catch (e) { if (e && e.code === 'declined') { toast('Save cancelled'); return false; } }
    }
    if (!(window.claude && window.claude.use)) {
      try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type: filename.endsWith('.html') ? 'text/html' : filename.endsWith('.csv') ? 'text/csv' : 'application/json' }));
        a.download = filename; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast('Saved ' + filename + ' to your Downloads');
        return true;
      } catch (e) { /* fall through to copy */ }
    }
    modal('Copy your file', `<p class="note">Saving files is not available in this view. Copy the text below, paste it into a new file and name it <b>${esc(filename)}</b>.</p><textarea id="copyArea" class="inp" style="width:100%;min-height:200px;font-family:var(--font-code);font-size:12px">${esc(data)}</textarea>`,
      [{ label: 'Copy', cls: 'go', keep: true, run: () => copyText($('#copyArea').value) }, { label: 'Close' }]);
    return false;
  }
  function copyText(t) {
    navigator.clipboard.writeText(t).then(() => toast('Copied'), () => { const a = $('#copyArea'); if (a) { a.select(); toast('Press Ctrl+C to copy'); } });
  }

  /* ---------------- design history ---------------- */
  function commit(label) {
    undoStack.push(JSON.stringify(design)); if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }
  function changed() {
    Design.normalize(design);
    store.set('design', design);
    pilotDirty = true;
    rebuildBuilder();
    renderSide();
    if (mode === 'build') renderViewButtons();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(design)); design = JSON.parse(undoStack.pop()); sel = null; changed(); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(design)); design = JSON.parse(redoStack.pop()); sel = null; changed(); }

  /* ---------------- three.js setup ---------------- */
  const canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputEncoding = THREE.sRGBEncoding;
  const isDark = () => document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

  // Builder scene
  const bScene = new THREE.Scene();
  const bCam = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  bScene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.85));
  const bSun = new THREE.DirectionalLight(0xffffff, 0.75); bSun.position.set(1, 2, 1.5); bScene.add(bSun);
  const bGrid = new THREE.Group(); bScene.add(bGrid);
  let bRov = null; const bMarkers = new THREE.Group(); bScene.add(bMarkers);
  const orbit = { target: V3(0, 4 * IN, 0), r: 1.25, th: 0.75, ph: 1.05 };

  function buildGrid() {
    bGrid.clear();
    const dark = isDark();
    bScene.background = new THREE.Color(dark ? 0x10222a : 0xd9e5e8);
    const g1 = new THREE.GridHelper(48 * IN, 48, dark ? 0x2b4650 : 0xb9cbd0, dark ? 0x1d333b : 0xc9d8dc);
    const g6 = new THREE.GridHelper(48 * IN, 8, dark ? 0x4f7682 : 0x86a3ab, dark ? 0x4f7682 : 0x86a3ab);
    bGrid.add(g1, g6);
    const lbl = World.textSprite('FRONT', dark ? '#9fd8e0' : '#0f4a55', 0.18);
    lbl.rotation.x = -Math.PI / 2; lbl.position.set(0, 0.001, -24 * IN + 0.06); bGrid.add(lbl);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 3), new THREE.MeshBasicMaterial({ color: dark ? 0x9fd8e0 : 0x0f4a55 }));
    arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 0.002, -24 * IN + 0.13); bGrid.add(arrow);
    const ruler = World.textSprite('grid: 1 in · bold: 6 in', dark ? '#7fa1aa' : '#53717a', 0.3);
    ruler.rotation.x = -Math.PI / 2; ruler.position.set(18 * IN, 0.001, 22 * IN); bGrid.add(ruler);
  }

  /* ---------------- builder scene ---------------- */
  const STEPS = [
    { k: 'frame', label: 'Frame' }, { k: 'motors', label: 'Motors' }, { k: 'camera', label: 'Camera' }, { k: 'tools', label: 'Tools' },
    { k: 'trim', label: 'Trim' }, { k: 'power', label: 'Power' }, { k: 'check', label: 'Check' }
  ];
  let placing = null;   // { type, dir, ghost, at, ok }
  let partDrag = null;  // { id, moved, x, y, committed }
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x19c3d6, transparent: true, opacity: 0.55, depthTest: false });
  const handleMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a, depthTest: false });
  const handleHot = new THREE.MeshBasicMaterial({ color: 0xffc04d, depthTest: false });
  const pipCam = new THREE.PerspectiveCamera(85, 4 / 3, 0.01, 30);

  function rebuildBuilder() {
    if (bRov) bScene.remove(bRov);
    bRov = World.buildRov(design);
    bScene.add(bRov);
    const lo = Design.bounds(design).lo[1];
    bGrid.position.y = (lo - 0.5) * IN;
    bMarkers.clear();
    const onFrame = buildStep === 'frame';
    const jm = new THREE.MeshBasicMaterial({ color: 0x1b7fd1, depthTest: false }), sm = new THREE.MeshBasicMaterial({ color: 0xff7a1a, depthTest: false });
    if (onFrame) {
      for (const [k, j] of Design.joints(design)) {
        const isSel = sel && sel.p && sel.kind !== 'part' && Design.key(sel.p) === k;
        const m = new THREE.Mesh(new THREE.SphereGeometry(isSel ? 0.012 : 0.0085, 12, 10), isSel ? sm : jm);
        m.position.set(...j.p.map(v => v * IN));
        m.userData.joint = j.p; m.renderOrder = 5;
        bMarkers.add(m);
      }
      if (sel && sel.kind === 'pipe' && sel.p) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), sm);
        m.renderOrder = 6; m.position.set(...sel.p.map(v => v * IN)); bMarkers.add(m);
      }
      // orange arrows: click one to grow a pipe that way
      if (sel && sel.p && sel.kind !== 'part') {
        const used = new Set();
        const j = Design.joints(design).get(Design.key(sel.p));
        if (j) j.dirs.forEach(d => used.add(d.join(',')));
        if (sel.kind === 'pipe') { const p = design.pipes[sel.i]; if (p) { const d = p.b.map((v, i) => Math.sign(v - p.a[i])); used.add(d.join(',')); used.add(d.map(v => -v).join(',')); } }
        Object.entries(DIRS).forEach(([dk, D]) => {
          if (used.has(D.v.join(','))) return;
          const g = new THREE.Group();
          const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 8), handleMat);
          shaft.position.y = 0.035;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 12), handleMat);
          cone.position.y = 0.07;
          const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.09, 8), new THREE.MeshBasicMaterial({ visible: false }));
          hit.position.y = 0.045;
          [shaft, cone, hit].forEach(m => { m.userData.handle = dk; m.renderOrder = 8; g.add(m); });
          g.position.set(...sel.p.map(v => v * IN));
          g.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(...D.v));
          g.userData.handle = dk;
          bMarkers.add(g);
        });
      }
    }
    if (sel && sel.kind === 'pipe' && design.pipes[sel.i]) {
      bRov.children[0].children.forEach(c => { if (c.userData.pipe === sel.i) c.material = World.mat('pipeSel', 0xffa64d); });
    }
    if (sel && sel.kind === 'part' && bRov.userData.parts[sel.id]) {
      const box = new THREE.BoxHelper(bRov.userData.parts[sel.id], 0xff7a1a); box.material.depthTest = false; box.renderOrder = 9; bMarkers.add(box);
    }
    // green arrows show which way each motor pushes
    design.parts.forEach(p => {
      const P = PARTS[p.type];
      if (!P || P.kind !== 'thruster') return;
      const a = new THREE.ArrowHelper(V3(...DIRS[p.dir].v), V3(...p.at).multiplyScalar(IN), 0.11, 0x22b455, 0.035, 0.02);
      a.traverse(o => { if (o.material) o.material.depthTest = false; o.renderOrder = 7; });
      bMarkers.add(a);
    });
    // balance markers: center of mass (red, gravity) and center of buoyancy (blue, lift)
    if (opts.balance && design.pipes.length && (buildStep === 'trim' || buildStep === 'check')) {
      const mp = Design.massProps(design);
      const cmM = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), new THREE.MeshBasicMaterial({ color: 0xe0362c, depthTest: false }));
      cmM.position.set(...mp.cm); cmM.renderOrder = 7; bMarkers.add(cmM);
      const cbM = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 10), new THREE.MeshBasicMaterial({ color: 0x1b7fd1, depthTest: false }));
      cbM.position.set(...mp.cb); cbM.renderOrder = 7; bMarkers.add(cbM);
      const aD = new THREE.ArrowHelper(V3(0, -1, 0), V3(...mp.cm), 0.09, 0xe0362c, 0.025, 0.015);
      const aU = new THREE.ArrowHelper(V3(0, 1, 0), V3(...mp.cb), 0.09, 0x1b7fd1, 0.025, 0.015);
      [aD, aU].forEach(a => a.traverse(o => { if (o.material) { o.material.depthTest = false; } o.renderOrder = 7; }));
      bMarkers.add(aD, aU);
    }
    if (placing && placing.ghost) bMarkers.add(placing.ghost);
    setHint();
  }

  function placeBCam() {
    const o = orbit;
    o.ph = Math.max(0.08, Math.min(Math.PI - 0.08, o.ph));
    o.r = Math.max(0.25, Math.min(4, o.r));
    bCam.position.set(o.target.x + o.r * Math.sin(o.ph) * Math.sin(o.th), o.target.y + o.r * Math.cos(o.ph), o.target.z + o.r * Math.sin(o.ph) * Math.cos(o.th));
    bCam.lookAt(o.target);
  }
  function fitBuilder() {
    const b = Design.bounds(design);
    orbit.target.set((b.lo[0] + b.hi[0]) / 2 * IN, (b.lo[1] + b.hi[1]) / 2 * IN, (b.lo[2] + b.hi[2]) / 2 * IN);
    orbit.r = Math.max(0.5, Math.max(...b.size) * IN * 2.4);
  }

  // Pool scene
  const pScene = new THREE.Scene();
  const pCam = new THREE.PerspectiveCamera(70, 1, 0.02, 80);
  pScene.add(new THREE.HemisphereLight(0xdff6ff, 0x2f5f6a, 0.9));
  const pSun = new THREE.DirectionalLight(0xffffff, 0.7); pSun.position.set(3, 10, 4); pScene.add(pSun);
  const pWorld = new THREE.Group(); pScene.add(pWorld);
  const fogUnder = new THREE.FogExp2(0x0d5a6c, 0.14), fogAir = new THREE.FogExp2(0xbfe3ee, 0.012), bgUnder = new THREE.Color(0x0d5a6c), bgAir = new THREE.Color(0xbfe3ee);
  // drifting particles for an underwater feel
  const snowGeo = new THREE.BufferGeometry();
  const snowN = 500, snowPos = new Float32Array(snowN * 3);
  for (let i = 0; i < snowN * 3; i++) snowPos[i] = (Math.random() - 0.5) * 6;
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xcfeff5, size: 0.012, transparent: true, opacity: 0.55 }));
  pScene.add(snow);

  /* ---------------- builder input: orbit, pick, place, drag ---------------- */
  const ptrs = new Map(); let drag = null;
  const ray = new THREE.Raycaster();
  function rayFrom(e) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), bCam);
    return ray;
  }
  function hitPart(e) {
    const hits = rayFrom(e).intersectObjects(bRov.children[1].children, true);
    for (const h of hits) { let o = h.object; while (o && o.userData.partId === undefined && o.parent) o = o.parent; if (o && o.userData.partId !== undefined) return o.userData.partId; }
    return null;
  }
  const vecKey = v => (Object.entries(DIRS).find(([, D]) => D.v[0] === v[0] && D.v[1] === v[1] && D.v[2] === v[2]) || ['fwd'])[0];
  // Where a part would sit if dropped where the pointer is: on the side of the pipe you point at.
  function snapPart(e, type) {
    const hits = rayFrom(e).intersectObjects(bRov.children[0].children.filter(c => c.userData.pipe !== undefined), false);
    if (!hits.length) return null;
    const h = hits[0], p = design.pipes[h.object.userData.pipe];
    const ax = [0, 1, 2].find(i => p.a[i] !== p.b[i]);
    const hp = h.point.clone().divideScalar(IN).toArray();
    const base = p.a.slice();
    base[ax] = Math.round(Math.max(Math.min(p.a[ax], p.b[ax]), Math.min(Math.max(p.a[ax], p.b[ax]), hp[ax])) * 2) / 2;
    const n = h.face.normal.clone().transformDirection(h.object.matrixWorld).toArray();
    n[ax] = 0;
    const big = [0, 1, 2].reduce((a, i) => Math.abs(n[i]) > Math.abs(n[a]) ? i : a, ax === 0 ? 1 : 0);
    const nk = [0, 0, 0]; nk[big] = Math.sign(n[big]) || 1;
    const P = PARTS[type];
    const r = P.kind === 'thruster' ? P.size[0] / 2 : P.kind === 'camera' ? 0.025 : P.kind === 'float' ? P.size[0] / 2 : P.kind === 'weight' ? (type === 'sinker' ? P.size[1] / 2 : 0.012) : 0;
    const off = (r ? U.PIPE.od / 2 + r : 0) / IN;
    const at = base.map((v, i) => Math.round((v + nk[i] * off) * 2) / 2);
    let dir;
    if (P.kind === 'thruster') dir = nk[1] ? 'up' : 'fwd';
    else if (P.kind === 'float') dir = ['right', 'up', 'back'][ax];
    else if (P.kind === 'tool' && P.tool !== 'ruler') dir = nk[1] ? 'fwd' : vecKey(nk);
    else dir = 'fwd';
    return { at, dir };
  }
  function makeGhost(type, dir) {
    const g = World.partMesh({ id: 'ghost', type, at: [0, 0, 0], dir, tilt: -20, qty: 1 }, 0);
    g.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.renderOrder = 10; } });
    return g;
  }
  function startPlacing(type) {
    placing = { type, dir: null, ghost: null, at: null };
    sel = null;
    rebuildBuilder(); renderBuild();
  }
  function stopPlacing() { placing = null; rebuildBuilder(); renderBuild(); }

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    drag = { x: e.clientX, y: e.clientY, moved: 0, btn: e.button, shift: e.shiftKey };
    if (mode === 'build' && !placing && e.button === 0 && !e.shiftKey && ptrs.size === 1) {
      rayFrom(e);
      const onHandle = ray.intersectObjects(bMarkers.children, true).some(h => h.object.userData.handle || h.object.userData.joint);
      const id = onHandle ? null : hitPart(e);
      if (id) partDrag = { id, moved: 0, committed: false };
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (mode === 'build' && !ptrs.size) return builderHover(e);
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      partDrag = null;
      const other = [...ptrs.entries()].find(([id]) => id !== e.pointerId)[1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (mode === 'build') { orbit.r *= d0 / Math.max(1, d1); pan(dx / 2, dy / 2); }
      else camZoom *= d0 / Math.max(1, d1);
      return;
    }
    if (!drag) return;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (mode !== 'build') { camYaw -= dx * 0.006; camPitch = Math.max(-1.2, Math.min(1.2, camPitch - dy * 0.006)); return; }
    if (placing) { if (drag.moved > 6) { orbit.th -= dx * 0.008; orbit.ph -= dy * 0.008; } builderHover(e); return; }
    if (partDrag) {
      partDrag.moved += Math.abs(dx) + Math.abs(dy);
      if (partDrag.moved < 5) return;
      const part = design.parts.find(p => p.id === partDrag.id); if (!part) return;
      const s = snapPart(e, part.type);
      if (!s) return;
      if (!partDrag.committed) { commit(); partDrag.committed = true; sel = { kind: 'part', id: part.id }; }
      part.at = s.at;
      const m = bRov.userData.parts[part.id];
      if (m) m.position.set(...part.at.map(v => v * IN));
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (drag.btn === 2 || drag.shift) pan(dx, dy);
    else { orbit.th -= dx * 0.008; orbit.ph -= dy * 0.008; }
  });
  const endPtr = e => {
    if (mode === 'build' && ptrs.size === 1 && drag) {
      if (partDrag) {
        if (partDrag.committed) { canvas.style.cursor = ''; changed(); }
        else { sel = { kind: 'part', id: partDrag.id }; const P = PARTS[(design.parts.find(p => p.id === partDrag.id) || {}).type]; if (P) jumpToPartStep(P); afterSelect(); }
      } else if (drag.moved < 6) {
        if (placing) placeAt(e); else pick(e);
      }
    }
    partDrag = null;
    ptrs.delete(e.pointerId); if (!ptrs.size) drag = null;
  };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); drag = null; partDrag = null; });
  canvas.addEventListener('pointerleave', () => { $('#btip').hidden = true; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); if (mode === 'build') orbit.r *= Math.exp(e.deltaY * 0.001); else camZoom = Math.max(0.4, Math.min(3, camZoom * Math.exp(e.deltaY * 0.001))); }, { passive: false });
  function pan(dx, dy) {
    const s = orbit.r * 0.0014;
    const right = V3().setFromMatrixColumn(bCam.matrix, 0), up = V3().setFromMatrixColumn(bCam.matrix, 1);
    orbit.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  }

  function builderHover(e) {
    const tip = $('#btip');
    const r = canvas.getBoundingClientRect();
    let label = '', cursor = '';
    if (placing) {
      const s = snapPart(e, placing.type);
      if (s) {
        if (!placing.ghost || placing.dir !== s.dir) {
          if (placing.ghost) bMarkers.remove(placing.ghost);
          placing.ghost = makeGhost(placing.type, s.dir); placing.dir = s.dir; bMarkers.add(placing.ghost);
        }
        placing.ghost.visible = true;
        placing.ghost.position.set(...s.at.map(v => v * IN));
        placing.at = s.at;
        label = 'Click to place it here'; cursor = 'copy';
      } else { if (placing.ghost) placing.ghost.visible = false; placing.at = null; label = 'Point at a pipe'; cursor = 'not-allowed'; }
    } else {
      rayFrom(e);
      const hh = ray.intersectObjects(bMarkers.children, true).find(h => h.object.userData.handle);
      const jj = ray.intersectObjects(bMarkers.children.filter(c => c.userData.joint), false)[0];
      const pid = hitPart(e);
      bMarkers.children.forEach(g => { if (g.userData.handle) g.children.forEach(m => { if (m.material.visible !== false) m.material = hh && hh.object.userData.handle === g.userData.handle ? handleHot : handleMat; }); });
      if (hh) { label = `Add a ${pipeLen} in pipe going ${DIRS[hh.object.userData.handle].label.toLowerCase()}`; cursor = 'pointer'; }
      else if (jj) { label = 'Joint: click to grow pipes from here'; cursor = 'pointer'; }
      else if (pid) { const p = design.parts.find(q => q.id === pid); label = PARTS[p.type].short + ': drag to move, click to edit'; cursor = 'grab'; }
      else {
        const ph = ray.intersectObjects(bRov.children[0].children.filter(c => c.userData.pipe !== undefined), false)[0];
        if (ph) { const p = design.pipes[ph.object.userData.pipe]; label = `Pipe, ${Math.round(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]))} in: click to select`; cursor = 'pointer'; }
      }
    }
    canvas.style.cursor = cursor;
    tip.hidden = !label;
    if (label) { tip.textContent = label; tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 14) + 'px'; }
  }

  function pick(e) {
    rayFrom(e);
    const hh = ray.intersectObjects(bMarkers.children, true).find(h => h.object.userData.handle);
    if (hh) return addPipeAction(hh.object.userData.handle);
    const jHits = ray.intersectObjects(bMarkers.children.filter(c => c.userData.joint), false);
    if (jHits.length) { sel = { kind: 'joint', p: jHits[0].object.userData.joint.slice() }; return afterSelect(); }
    const ph = ray.intersectObjects(bRov.children[0].children.filter(c => c.userData.pipe !== undefined), false)[0];
    if (ph) {
      const p = design.pipes[ph.object.userData.pipe];
      const hp = ph.point.clone().divideScalar(IN);
      const ax = [0, 1, 2].find(i => p.a[i] !== p.b[i]);
      const pt = p.a.slice(); pt[ax] = Math.round(Math.max(Math.min(p.a[ax], p.b[ax]), Math.min(Math.max(p.a[ax], p.b[ax]), hp.getComponent(ax))));
      sel = { kind: 'pipe', i: ph.object.userData.pipe, p: pt };
      if (buildStep !== 'frame') setStep('frame', true);
      return afterSelect();
    }
    sel = null; afterSelect();
  }
  function afterSelect() { rebuildBuilder(); renderSide(); }
  function jumpToPartStep(P) {
    const k = P.kind === 'thruster' ? 'motors' : P.kind === 'camera' ? 'camera' : P.kind === 'tool' ? 'tools' : 'trim';
    if (buildStep !== k) setStep(k, true);
  }

  function placeAt(e) {
    builderHover(e);
    if (!placing || !placing.at) { toast('Point at a pipe to place the part.'); return; }
    commit();
    const P = PARTS[placing.type];
    const part = { id: Design.uid(), type: placing.type, at: placing.at.slice(), dir: placing.dir || 'fwd' };
    if (P.kind === 'camera') part.tilt = -20;
    if (P.kind === 'weight') part.qty = 1;
    design.parts.push(part);
    const keep = e.shiftKey;
    sel = { kind: 'part', id: part.id };
    if (!keep) placing = null; else { placing.ghost = null; }
    changed();
    toast(`${P.short} placed. Drag it to move it${P.kind === 'thruster' ? ', and check its green arrow points the way you want it to push' : ''}.`);
  }

  /* ---------------- building actions ---------------- */
  const MIRROR_DIR = { left: 'right', right: 'left' };
  function addPipeAction(dir) {
    if (!sel || !sel.p) { toast('Click a joint or a spot on a pipe first.'); return; }
    commit();
    const r = Design.addPipe(design, sel.p, dir, pipeLen);
    if (!r.ok) { undoStack.pop(); toast(r.msg); return; }
    if (mirror && sel.p[0] !== 0) Design.addPipe(design, [-sel.p[0], sel.p[1], sel.p[2]], MIRROR_DIR[dir] || dir, pipeLen);
    else if (mirror && sel.p[0] === 0 && (dir === 'left' || dir === 'right')) Design.addPipe(design, sel.p, MIRROR_DIR[dir], pipeLen);
    design.box = null;
    sel = { kind: 'joint', p: r.end };
    changed();
  }
  function deleteSelected() {
    if (!sel) return;
    commit();
    if (sel.kind === 'pipe') {
      const p = design.pipes[sel.i];
      const ma = [-p.a[0], p.a[1], p.a[2]], mb = [-p.b[0], p.b[1], p.b[2]];
      Design.removePipe(design, sel.i);
      if (mirror && p.a[0] + p.b[0] !== 0) {
        const j = design.pipes.findIndex(q => (Design.eq(q.a, ma) && Design.eq(q.b, mb)) || (Design.eq(q.a, mb) && Design.eq(q.b, ma)));
        if (j >= 0) Design.removePipe(design, j);
      }
      design.box = null;
    } else if (sel.kind === 'part') {
      design.parts = design.parts.filter(p => p.id !== sel.id);
    } else if (sel.kind === 'joint') {
      const k = Design.key(sel.p);
      const idx = design.pipes.map((p, i) => (Design.key(p.a) === k || Design.key(p.b) === k) ? i : -1).filter(i => i >= 0).sort((a, b) => b - a);
      idx.forEach(i => design.pipes.splice(i, 1));
      design.box = null;
    }
    sel = null; changed();
  }
  function selPart() { return sel && sel.kind === 'part' ? design.parts.find(p => p.id === sel.id) : null; }
  function nudge(axis, d) {
    const p = selPart(); if (!p) return;
    commit(); p.at[axis] = Math.round((p.at[axis] + d) * 2) / 2; changed();
  }
  function mirrorPart() {
    const p = selPart(); if (!p) return;
    commit();
    const q = JSON.parse(JSON.stringify(p)); q.id = Design.uid(); q.at[0] = -q.at[0]; if (MIRROR_DIR[q.dir]) q.dir = MIRROR_DIR[q.dir];
    if (q.at[0] === p.at[0]) q.at[0] += 2;
    design.parts.push(q); sel = { kind: 'part', id: q.id }; changed();
    toast('Copied to the other side.');
  }
  const TURN = { thruster: ['fwd', 'back', 'up', 'down', 'left', 'right'], float: ['back', 'right', 'up'], tool: ['fwd', 'down', 'left', 'right', 'back', 'up'] };
  function turnPart() {
    const p = selPart(); if (!p) return;
    const list = TURN[PARTS[p.type].kind]; if (!list || PARTS[p.type].tool === 'ruler') return;
    commit(); p.dir = list[(list.indexOf(p.dir) + 1) % list.length]; changed();
  }
  function setPartDir(d) { const p = selPart(); if (!p) return; commit(); p.dir = d; changed(); }

  function pipeBounds() {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    design.pipes.forEach(p => [p.a, p.b].forEach(v => v.forEach((x, i) => { lo[i] = Math.min(lo[i], x); hi[i] = Math.max(hi[i], x); })));
    return { lo, hi };
  }
  // add a crossbar at height y across the middle if the frame has side rails there
  function ensureBar(y, which) {
    const { lo, hi } = pipeBounds();
    if (Design.distToFrame(design, [0, y, 0]) < 0.5) return;
    if (Design.distToFrame(design, [lo[0], y, 0]) < 0.01 && Design.distToFrame(design, [hi[0], y, 0]) < 0.01) {
      design.pipes.push({ a: [lo[0], y, 0], b: [hi[0], y, 0] });
      Design.normalize(design);
      if (design.box) design.box[which] = true;
    }
  }
  const MOTOR_LAYOUTS = {
    basic: { label: '3 motors', desc: '2 push forward (drive and turn) + 1 vertical (dive and rise). The workshop design.' },
    strafe: { label: '4 motors', desc: 'Adds a sideways motor so you can slide left and right to line up on hooks and rings.' },
    power: { label: '6 motors', desc: '4 forward + 2 vertical. Fast and strong, but watch the 25 A fuse.' }
  };
  function applyMotorLayout(kind, type) {
    if (!design.pipes.length) { toast('Build a frame first.'); return; }
    commit();
    design.parts = design.parts.filter(p => PARTS[p.type].kind !== 'thruster');
    const { lo, hi } = pipeBounds();
    const add = (target, dir, sideOff) => {
      const n = Design.nearestOnFrame(design, target).p;
      const at = [n[0] + (sideOff || 0), n[1], n[2]].map(v => Math.round(v * 2) / 2);
      design.parts.push({ id: Design.uid(), type, at, dir });
    };
    const midY = Math.round((lo[1] + hi[1]) / 2), rearZ = hi[2] - 1, off = 1.5;
    if (kind === 'power') {
      [lo[1] + 1, hi[1] - 1].forEach(y => { add([hi[0], y, rearZ], 'fwd', off); add([lo[0], y, rearZ], 'fwd', -off); });
      ensureBar(hi[1], 'top');
      add([Math.round(hi[0] / 2), hi[1], 0], 'down'); add([Math.round(lo[0] / 2), hi[1], 0], 'down');
    } else {
      add([hi[0], midY, rearZ], 'fwd', off); add([lo[0], midY, rearZ], 'fwd', -off);
      ensureBar(hi[1], 'top');
      add([0, hi[1], 0], 'down');
      if (kind === 'strafe') { ensureBar(lo[1], 'bottom'); add([0, lo[1], 0], 'right'); }
    }
    sel = null; changed();
    toast(`Motors placed: ${MOTOR_LAYOUTS[kind].label}. Undo with ↶ if you want your old ones back.`);
  }
  function quickCamera() {
    if (!design.pipes.length) { toast('Build a frame first.'); return; }
    commit();
    const { lo, hi } = pipeBounds();
    const n = Design.nearestOnFrame(design, [0, hi[1], lo[2]]).p;
    const part = { id: Design.uid(), type: design.parts.some(p => p.type === 'fishcam') ? 'fishcam2' : 'fishcam', at: [n[0], n[1] - 1, n[2] - 1.5], dir: 'fwd', tilt: -20 };
    design.parts.push(part); sel = { kind: 'part', id: part.id }; changed();
  }

  // Add ballast (or floats) where they best keep the ROV level, aiming for about +40 g.
  function autoTrim(pass) {
    pass = pass || 0;
    const mp = Design.massProps(design);
    if (!design.pipes.length) return;
    const { lo, hi } = pipeBounds();
    const zs = []; for (let z = lo[2]; z <= hi[2]; z++) zs.push(z);
    const sinkOf = t => PARTS[t].g - PARTS[t].cm3, liftOf = t => PARTS[t].cm3 - PARTS[t].g;
    const tryPlan = plan => { const d = Design.clone(design); plan.forEach(x => d.parts.push(Object.assign({ id: Design.uid() }, JSON.parse(JSON.stringify(x))))); return { d, mp: Design.massProps(d) }; };
    let best = null;
    const score = r => Math.abs(r.mp.pitch || 90) + Math.abs(r.mp.roll || 0) * 2 + Math.abs(r.mp.net - 40) / 15;
    if (mp.net > (pass ? 75 : 60)) {
      const need = mp.net - 40;
      zs.forEach(z => {
        const spots = [[lo[0], lo[1], z], [hi[0], lo[1], z]].filter(s => Design.distToFrame(design, s) < 0.01);
        if (spots.length < 2) return;
        const big = Math.floor(need / (sinkOf('sinker') * 2));
        const small = Math.max(0, Math.min(12, Math.round((need - big * 2 * sinkOf('sinker')) / (sinkOf('washer') * 2))));
        const plan = [];
        spots.forEach(s => {
          if (big) plan.push({ type: 'sinker', at: [s[0], s[1] - 1, s[2]], dir: 'fwd', qty: Math.min(12, big) });
          if (small) plan.push({ type: 'washer', at: [s[0], s[1] - 1, s[2]], dir: 'fwd', qty: small });
        });
        if (!plan.length) return;
        const r = tryPlan(plan); r.plan = plan;
        if (!best || score(r) < score(best)) best = r;
      });
    } else if (mp.net < -15) {
      const need = 40 - mp.net;
      const type = ['noodle3', 'noodle6', 'noodle12'].find(t => liftOf(t) * 2 >= need) || 'noodle12';
      const pairs = Math.max(1, Math.ceil(need / (liftOf(type) * 2)));
      zs.forEach(z => {
        const spots = [[lo[0], hi[1], z], [hi[0], hi[1], z]].filter(s => Design.distToFrame(design, s) < 0.01);
        if (spots.length < 2) return;
        const plan = [];
        // stack on top of any floats already at this spot
        const stack = sp => design.parts.filter(q => PARTS[q.type].kind === 'float' && Math.abs(q.at[0] - sp[0]) < 2 && Math.abs(q.at[2] - sp[2]) < 5 && q.at[1] > sp[1]).length;
        for (let k = 0; k < pairs; k++) spots.forEach(s => plan.push({ type, at: [s[0], s[1] + 1.5 + (k + stack(s)) * 2.6, s[2]], dir: 'back' }));
        const r = tryPlan(plan); r.plan = plan;
        if (!best || score(r) < score(best)) best = r;
      });
    } else { if (!pass) toast('Buoyancy is already good. Use the tips below to level it.'); return; }
    if (!best) { toast('Could not find a good spot. Add the parts by hand on the bottom (weights) or top (floats).'); return; }
    if (!pass) commit();
    best.plan.forEach(x => design.parts.push(Object.assign({ id: Design.uid() }, x)));
    const names = autoTrim.names = pass ? autoTrim.names : {};
    best.plan.forEach(x => names[PARTS[x.type].short] = (names[PARTS[x.type].short] || 0) + (x.qty || 1));
    // floats come in big steps, so fine-tune with weights afterwards
    if (!pass && best.mp.net > 75) return autoTrim(1);
    sel = null; changed();
    toast('Added ' + Object.entries(names).map(([k, v]) => `${v} × ${k}`).join(' and ') + `. Now ${Math.round(Design.massProps(design).net)} g.`);
  }

  function setBoxDims(changes) {
    commit();
    const B = Object.assign({}, design.box || { w: 12, h: 8, l: 14, top: true, bottom: false, mid: false }, changes);
    if (!design.box) { Design.setBox(design, B); } else Design.resizeBox(design, B);
    sel = null; changed();
  }

  /* ---------------- side panel: guided build steps ---------------- */
  function renderSide() {
    if (mode === 'build') renderBuild(); else renderPilot();
  }

  // Junior mode skips the wiring step, so only the build checks count toward its inspection.
  function insView() {
    const ins = Design.inspect(design);
    if (!opts.junior) return ins;
    const items = ins.items.filter(i => i.kind === 'build' || i.id === 'B3');
    return Object.assign({}, ins, { items, ok: items.filter(i => i.kind !== 'warn').every(i => i.pass) });
  }
  const activeSteps = () => opts.junior ? STEPS.filter(s => s.k !== 'power') : STEPS;
  const JR_GOALS = {
    frame: 'The frame holds everything together. Drag the sliders to make your box the size you want.',
    motors: 'Motors push your ROV. Pick a layout to start. The green arrows show which way each motor pushes.',
    camera: 'The pilot drives by looking through the camera. Point it at the front so you can see where you are going.',
    tools: 'Tools grab and measure things in the challenges. Pick the ones you need.',
    trim: 'Make it float just a little. Noodles make it float more, weights make it sink more. Aim for the green zone.',
    check: 'Check that everything is ready, then take your ROV to the pool!'
  };
  function stepStatus() {
    const mp = Design.massProps(design), ins = insView();
    const thr = design.parts.filter(p => PARTS[p.type].kind === 'thruster');
    const elecOk = Object.keys(ELECTRICAL).every(k => ELECTRICAL[k].options[design.elec[k]].pass);
    return {
      frame: design.pipes.length >= 8 && Design.inspect(design).items.find(i => i.id === 'B2').pass,
      motors: thr.some(p => ['fwd', 'back'].includes(p.dir)) && thr.some(p => ['up', 'down'].includes(p.dir)),
      camera: design.parts.some(p => PARTS[p.type].kind === 'camera'),
      tools: design.parts.some(p => PARTS[p.type].kind === 'tool'),
      trim: mp.net >= -15 && mp.net <= 90 && mp.sep > 0.002 && Math.abs(mp.pitch) <= 8 && Math.abs(mp.roll) <= 4,
      power: elecOk,
      check: ins.ok
    };
  }

  function buildSummary() {
    const mp = Design.massProps(design), ins = insView();
    const net = Math.round(mp.net);
    let bCls, bTxt, bSub;
    if (!design.pipes.length) { bCls = ''; bTxt = '—'; bSub = 'no frame yet'; }
    else if (Math.abs(net) <= 15) { bCls = 'good'; bTxt = (net >= 0 ? '+' : '') + net + ' g'; bSub = 'neutral'; }
    else if (net > 15 && net <= 90) { bCls = 'good'; bTxt = '+' + net + ' g'; bSub = 'floats slowly'; }
    else if (net > 90) { bCls = 'warn'; bTxt = '+' + net + ' g'; bSub = 'too floaty'; }
    else { bCls = net < -60 ? 'bad' : 'warn'; bTxt = net + ' g'; bSub = 'sinks'; }
    let tCls = 'good', tTxt, tSub;
    if (mp.sep <= 0.002) { tCls = 'bad'; tTxt = 'Unstable'; tSub = 'will roll over'; }
    else {
      const worst = Math.max(Math.abs(mp.pitch), Math.abs(mp.roll));
      tTxt = Math.abs(mp.pitch) < 1 ? 'Level' : (mp.pitch > 0 ? 'Nose ↑ ' : 'Nose ↓ ') + Math.abs(mp.pitch).toFixed(0) + '°';
      tSub = Math.abs(mp.roll) >= 1 ? `leans ${mp.roll > 0 ? 'right' : 'left'} ${Math.abs(mp.roll).toFixed(0)}°` : 'no lean';
      if (worst > 15) tCls = 'bad'; else if (worst > 6) tCls = 'warn';
    }
    const cost = ins.budget.total;
    const fails = ins.items.filter(i => !i.pass && i.kind !== 'warn').length;
    return `<div class="sum">
      <div class="stat ${bCls}" title="Net buoyancy in fresh water: positive floats up, negative sinks"><span>Buoyancy</span><b>${bTxt}</b><small>${bSub}</small></div>
      <div class="stat ${tCls}" title="How the ROV sits at rest"><span>Balance</span><b>${tTxt}</b><small>${tSub}</small></div>
      <div class="stat ${cost > 2000 ? 'bad' : ''}" title="Build budget, full retail price"><span>Cost</span><b>${fmt$(cost)}</b><small>${cost > 2000 ? 'over $2,000' : 'of $2,000'}</small></div>
      <div class="stat ${fails ? 'bad' : 'good'}"><span>Inspection</span><b>${fails ? fails + ' to fix' : 'Pass'}</b><small>${fails ? 'see the Check step' : 'ready'}</small></div>
    </div>`;
  }

  function setStep(k, quiet) {
    if (opts.junior && k === 'power') k = 'check';
    buildStep = k; store.set('buildStep', k);
    if (placing) placing = null;
    if (!quiet) { sel = null; rebuildBuilder(); renderBuild(); $('#sideBody').scrollTop = 0; }
  }

  function renderBuild() {
    const st = stepStatus();
    if (opts.junior && buildStep === 'power') buildStep = 'check';
    const STEPS = activeSteps();
    $('#sideHead').innerHTML = buildSummary() + `<ol class="stepper" aria-label="Build steps">${STEPS.map((s, i) =>
      `<li><button data-step="${s.k}" aria-current="${buildStep === s.k ? 'step' : 'false'}" class="${st[s.k] ? 'done' : ''}"><span class="num">${st[s.k] ? '✓' : i + 1}</span>${s.label}</button></li>`).join('')}</ol>`;
    const B = $('#sideBody');
    const idx = STEPS.findIndex(s => s.k === buildStep);
    const body = { frame: frameStep, motors: motorsStep, camera: cameraStep, tools: toolsStep, trim: trimStep, power: powerStep, check: checkStep }[buildStep]();
    const prev = STEPS[idx - 1], next = STEPS[idx + 1];
    B.innerHTML = (placing ? placingBanner() : '') + body + `<div class="stepnav">${prev ? `<button class="btn" data-step="${prev.k}">← ${prev.label}</button>` : '<span></span>'}${next ? `<button class="btn go" data-step="${next.k}">Next: ${next.label} →</button>` : `<button class="btn lime" data-act="goPilot">Go to the pool →</button>`}</div>`;
  }

  function placingBanner() {
    const P = PARTS[placing.type];
    return `<div class="placing"><div><b>Placing: ${esc(P.short)}</b><br>Click the side of a pipe in the 3D view where you want it. Hold Shift to place more than one.</div><button class="btn small" data-act="cancelPlace">Cancel (Esc)</button></div>`;
  }

  const stepHead = (n, title, goal) => {
    const S = activeSteps(), i = S.findIndex(s => s.k === buildStep);
    return `<div class="stephead"><span class="sec-label">Step ${i + 1} of ${S.length}${opts.junior ? ' · Junior mode' : ''}</span><h3>${title}</h3><p class="note">${opts.junior && JR_GOALS[buildStep] ? JR_GOALS[buildStep] : goal}</p></div>`;
  };

  function partCards(filter, tags) {
    return `<div class="cat">${Object.entries(PARTS).filter(([, P]) => filter(P)).map(([k, P]) => {
      const lift = Math.round(P.cm3 - P.g);
      const extra = P.kind === 'thruster' ? (opts.junior ? ({ gph500: 'gentle push', gph750: 'medium push', gph1100: 'strong push' })[k] : `${P.thrust} N push · ${P.amps} A`) : P.kind === 'float' || P.kind === 'weight' ? (lift >= 0 ? `lifts ${lift} g` : `sinks ${-lift} g`) : `${P.g} g`;
      return `<button class="pcard ${placing && placing.type === k ? 'on' : ''}" data-place="${k}" title="${esc(P.note)}"><b>${esc(P.short)}</b><span>${fmt$(P.price)} · ${extra}</span>${tags && tags[k] ? `<em>${tags[k]}</em>` : ''}</button>`;
    }).join('')}</div>`;
  }

  function partList(filter) {
    const list = design.parts.filter(q => filter(PARTS[q.type]));
    if (!list.length) return '';
    return `<ul class="plist">${list.map(q => {
      const P = PARTS[q.type];
      const loose = Math.min(Design.distToFrame(design, q.at), Design.distToFrame(design, Design.partCenter(q))) > 3.2;
      const what = P.kind === 'thruster' ? 'pushes ' + DIRS[q.dir].label.toLowerCase() : P.kind === 'camera' ? 'tilted ' + (q.tilt || 0) + '°' : P.kind === 'tool' && P.tool !== 'ruler' ? 'points ' + DIRS[q.dir].label.toLowerCase() : q.qty > 1 ? '× ' + q.qty : '';
      return `<li data-part="${q.id}" class="${sel && sel.id === q.id ? 'sel' : ''}">${esc(P.short)} <span class="note">${what}</span>${loose ? ' <span class="loose">not attached</span>' : ''}<button class="xbtn" data-delpart="${q.id}" aria-label="Remove ${esc(P.short)}" title="Remove">×</button></li>`;
    }).join('')}</ul>`;
  }

  function partEditor(kindFilter) {
    const p = selPart();
    if (!p || !kindFilter(PARTS[p.type])) return '';
    const P = PARTS[p.type];
    const loose = Math.min(Design.distToFrame(design, p.at), Design.distToFrame(design, Design.partCenter(p))) > 3.2;
    const dirLabel = P.kind === 'thruster' ? 'Pushes the ROV' : P.kind === 'float' ? 'Lies' : 'Points';
    const dirs = P.kind === 'float' ? [['back', 'front to back'], ['right', 'side to side'], ['up', 'upright']] : [['fwd', 'Forward'], ['back', 'Backward'], ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right']];
    return `<div class="card sel">
      <div class="row between"><b>${esc(P.name)}</b><span class="pill ${loose ? 'fail' : 'pass'}">${loose ? 'not attached' : 'attached'}</span></div>
      <p class="note">${esc(P.note)}</p>
      ${P.kind !== 'weight' && P.kind !== 'camera' && P.tool !== 'ruler' ? `<div class="sec" style="gap:4px"><span class="sec-label">${dirLabel}</span><div class="dirseg">${dirs.map(([k, l]) => `<button data-dir="${k}" aria-pressed="${p.dir === k}">${l}</button>`).join('')}</div></div>` : ''}
      ${P.kind === 'camera' ? `<label class="note">Tilt: <b>${p.tilt || 0}°</b> ${p.tilt < -45 ? '(looking down at your tool)' : p.tilt > -5 ? '(looking straight ahead)' : ''}<input type="range" id="pTilt" min="-90" max="20" step="5" value="${p.tilt || 0}" style="width:100%;accent-color:var(--accent)"></label>` : ''}
      ${P.kind === 'weight' ? `<div class="row"><span class="note">How many</span><button class="btn small" data-qty="-1">−</button><b>${p.qty || 1}</b><button class="btn small" data-qty="1">+</button><span class="note">${Math.round((P.g - P.cm3) * (p.qty || 1))} g of sink</span></div>` : ''}
      <div class="row"><button class="btn small" data-act="mirrorPart">Copy to the other side</button><button class="btn small" data-act="del">Remove</button></div>
      <details><summary>Fine adjust (1 inch at a time)</summary><div class="dpad" style="grid-template-columns:repeat(3,1fr);max-width:none;margin-top:6px">
        <button class="btn small" data-nudge="0,-1">← Left</button><button class="btn small" data-nudge="1,1">↑ Up</button><button class="btn small" data-nudge="2,-1">Toward front</button>
        <button class="btn small" data-nudge="0,1">Right →</button><button class="btn small" data-nudge="1,-1">↓ Down</button><button class="btn small" data-nudge="2,1">Toward back</button></div></details>
      <p class="note">Drag it in the 3D view to slide it along the frame.</p>
    </div>`;
  }

  function frameStep() {
    const B = design.box;
    const fc = {};
    Design.fittings(design).forEach(f => fc[f.type] = (fc[f.type] || 0) + 1);
    const inches = Design.pipeInches(design);
    const slider = (k, label, min, max, step) => `<label class="slider"><span class="row between"><span>${label}</span><b>${B[k]} in <small>(${Math.round(B[k] * 2.54)} cm)</small></b></span><input type="range" data-box="${k}" min="${min}" max="${max}" step="${step}" value="${B[k]}"></label>`;
    const boxCard = B ? `<div class="card">
        <span class="sec-label">Box frame size</span>
        ${slider('w', 'Width (side to side)', 8, 20, 2)}${slider('h', 'Height', 4, 14, 1)}${slider('l', 'Length (front to back)', 8, 24, 2)}
        <label class="chk"><input type="checkbox" data-boxopt="top" ${B.top ? 'checked' : ''}> Crossbar across the top (a place for a vertical motor)</label>
        <label class="chk"><input type="checkbox" data-boxopt="bottom" ${B.bottom ? 'checked' : ''}> Crossbar across the bottom</label>
        <label class="chk"><input type="checkbox" data-boxopt="mid" ${B.mid ? 'checked' : ''}> Side rails halfway up</label>
        <p class="note">Your parts move with the frame when you resize it. Smaller frames cost less and turn faster; bigger ones are steadier and have room for more parts.</p>
      </div>` : `<div class="card"><span class="sec-label">Custom frame</span><p class="note">You changed the frame by hand, so the size sliders are off. Switching back to a box replaces your custom pipes.</p><button class="btn small" data-act="toBox">Switch back to a box frame</button></div>`;
    return stepHead(1, 'Build the frame', 'The frame is what everything else attaches to. Most teams start with a simple box of ½" PVC pipe.') + boxCard + `
      <details class="card" ${B ? '' : 'open'}><summary>Change it by hand</summary>
        <ol class="howto"><li>Click a <span class="dot-b"></span> blue joint (or anywhere on a pipe).</li><li>Click an <span class="dot-o"></span> orange arrow to add a pipe that way.</li><li>To remove a pipe, click it and press Delete.</li></ol>
        <div class="row"><span class="note">New pipe length</span><div class="chips">${[2, 3, 4, 6, 8, 10, 12].map(n => `<button data-len="${n}" aria-pressed="${n === pipeLen}">${n}"</button>`).join('')}</div></div>
        <label class="chk"><input type="checkbox" id="mirror" ${mirror ? 'checked' : ''}> Mirror left and right (keeps the ROV balanced)</label>
        ${sel && sel.kind !== 'part' ? `<button class="btn small" data-act="del">Delete the selected ${sel.kind === 'joint' ? 'joint and its pipes' : 'pipe'}</button>` : ''}
      </details>
      ${opts.junior ? '' : `<div class="sec"><span class="sec-label">Pipes: flooded or sealed?</span>
        <label class="chk"><input type="radio" name="seal" value="0" ${design.sealed ? '' : 'checked'}> <span><b>Flooded</b>: drill holes so water fills the pipes. Simple and reliable; the frame sinks a little.</span></label>
        <label class="chk"><input type="radio" name="seal" value="1" ${design.sealed ? 'checked' : ''}> <span><b>Sealed</b>: glue and cap everything so air stays inside. The frame floats, but one leak changes everything.</span></label></div>
      <details><summary>Cut list: ${Math.round(inches)} in of pipe, ${Object.values(fc).reduce((a, b) => a + b, 0)} fittings</summary>
        <p class="note" style="margin-top:6px">${design.pipes.length} pieces from ${Math.ceil(inches / 120)} × 10 ft stick${Math.ceil(inches / 120) === 1 ? '' : 's'}. Lengths are center to center of the fittings.</p>
        <div class="tbl-wrap"><table class="tbl"><tbody>${Object.keys(FITTINGS).filter(k => fc[k]).map(k => `<tr><td>${FITTINGS[k].name}</td><td class="n">${fc[k]}</td></tr>`).join('') || '<tr><td class="note">No fittings yet</td></tr>'}</tbody></table></div></details>`}
      <details><summary>Or start from a ready-made ROV</summary><div class="row" style="margin-top:6px">${Object.entries(Design.PRESETS).map(([k, p]) => `<button class="btn small" data-preset="${k}">${esc(p.label.split(' (')[0])}</button>`).join('')}</div></details>`;
  }

  function motorsStep() {
    const isT = P => P.kind === 'thruster';
    const amps = Design.fullPowerAmps(design), fuseA = ELECTRICAL.fuse.options[design.elec.fuse].amps;
    const n = design.parts.filter(p => isT(PARTS[p.type])).length;
    return stepHead(2, 'Add motors', 'Bilge pump motors become thrusters. You need motors that push <b>forward</b> to drive and turn, and at least one that pushes <b>up or down</b> to dive.') + partEditor(isT) + `
      <div class="card"><span class="sec-label">Quick layouts</span>
        <div class="row"><span class="note">Motor size</span><div class="chips">${['gph500', 'gph750', 'gph1100'].map(k => `<button data-mtype="${k}" aria-pressed="${motorType === k}">${PARTS[k].short}</button>`).join('')}</div></div>
        <div class="layouts">${Object.entries(MOTOR_LAYOUTS).map(([k, L]) => `<button class="pcard" data-layout="${k}"><b>${L.label}</b><span>${L.desc}</span></button>`).join('')}</div>
        <p class="note">A layout replaces the motors you have now.</p></div>
      <div class="sec"><span class="sec-label">Or place them one at a time</span>${partCards(isT)}</div>
      ${n ? `<div class="sec"><span class="sec-label">Motors on your ROV (${n})${opts.junior ? '' : ` · ${amps.toFixed(1)} A at full power ${amps > fuseA ? '<span class="pill fail">over the fuse</span>' : ''}`}</span>${partList(isT)}</div>` : ''}
      <p class="tip"><b>Tip:</b> the green arrows on the model show which way each motor pushes. Mount forward motors near the middle height of the ROV so it doesn’t tip up when it drives.</p>`;
  }

  function cameraStep() {
    const isC = P => P.kind === 'camera';
    const has = design.parts.some(p => isC(PARTS[p.type]));
    return stepHead(3, 'Mount the camera', 'During a heat the pilot can only see what the camera sees. Aim it so you can see your tool and what is in front of the ROV.') + partEditor(isC) + `
      ${has ? '<p class="tip">The picture in the corner of the 3D view is what the pilot will see. Tilt the camera until your tool is in view.</p>' : `<button class="btn go" data-act="quickCam">Put a camera at the front</button>`}
      <div class="sec"><span class="sec-label">Cameras</span>${partCards(isC)}</div>
      ${partList(isC) ? `<div class="sec"><span class="sec-label">On your ROV</span>${partList(isC)}</div>` : ''}`;
  }

  function toolsStep() {
    const isT = P => P.kind === 'tool';
    const tags = { prong6: 'Rings (#2), egg sacs (#3)', prong12: 'Rings (#2), egg sacs (#3)', claw: 'Rings (#2), egg sacs (#3)', fork: 'Flag spool (#2)', ruler24: 'Hoop (#1)', meter: 'Hoop (#1)' };
    return stepHead(4, 'Choose your tools', 'Each challenge needs a way to grab or measure something. Pick tools for the challenges you will run. Point them forward, in view of the camera.') + partEditor(isT) + `
      <div class="sec">${partCards(isT, tags)}</div>
      ${partList(isT) ? `<div class="sec"><span class="sec-label">Tools on your ROV</span>${partList(isT)}</div>` : ''}
      <p class="tip"><b>Tip:</b> put prongs and claws low at the front so they can reach the pool floor. Mount the ruler across the front where the camera can read it.</p>`;
  }

  function gauge(net) {
    const lo = -300, hi = 300, x = v => (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * 100;
    return `<div class="gauge" role="img" aria-label="Buoyancy ${Math.round(net)} grams">
      <div class="g-track"><i class="g-zone" style="left:${x(0)}%;width:${x(90) - x(0)}%"></i><i class="g-mark" style="left:${x(net)}%"></i></div>
      <div class="g-scale"><span>sinks</span><span>0</span><span>floats</span></div></div>`;
  }

  function trimStep() {
    const isTW = P => P.kind === 'float' || P.kind === 'weight';
    const mp = Design.massProps(design), net = Math.round(mp.net);
    const tips = [];
    if (mp.sep <= 0.002) tips.push('The blue dot (lift) must be above the red dot (weight), or the ROV rolls over. Move floats up and weights down.');
    else {
      if (Math.abs(mp.pitch) > 6) tips.push(`It sits ${mp.pitch > 0 ? 'nose up' : 'nose down'} ${Math.abs(mp.pitch).toFixed(0)}°: move weight toward the ${mp.pitch > 0 ? 'front' : 'back'} or floats toward the ${mp.pitch > 0 ? 'back' : 'front'}.`);
      if (Math.abs(mp.roll) > 3) tips.push(`It leans ${mp.roll > 0 ? 'right' : 'left'}: move weight to the ${mp.roll > 0 ? 'left' : 'right'} side, or use "Copy to the other side" so both sides match.`);
    }
    const verdict = net > 90 ? `Too floaty (+${net} g). It will be hard to keep under water.` : net < -15 ? `Too heavy (${net} g). It will sink to the bottom.` : `Good buoyancy (${net >= 0 ? '+' : ''}${net} g).`;
    return stepHead(5, 'Trim it to float just right', 'Add pool noodles to lift it and weights to sink it. Aim for the green zone: slightly floaty, so a dead ROV comes back up. Keep it level.') + partEditor(isTW) + `
      <div class="card"><div class="row between"><b>${verdict}</b>${net > 90 || net < -15 ? `<button class="btn small go" data-act="autoTrim">${net > 90 ? 'Add weights for me' : 'Add floats for me'}</button>` : ''}</div>
        ${gauge(mp.net)}
        <div class="trim">${trimSvg(mp)}<div class="sec" style="gap:6px">${opts.junior ? '' : `<dl class="kv"><dt>Weight in air</dt><dd>${mp.M.toFixed(0)} g</dd><dt>Water pushed aside</dt><dd>${mp.V.toFixed(0)} cm³</dd><dt>Lift in water</dt><dd>${net >= 0 ? '+' : ''}${net} g</dd></dl>`}
          <p class="note"><span class="dot-r"></span> weight pulls down here<br><span class="dot-b"></span> water lifts up here</p></div></div>
        ${tips.map(t => `<p class="note">• ${esc(t)}</p>`).join('')}
      </div>
      <div class="sec"><span class="sec-label">Floats (put them up high)</span>${partCards(P => P.kind === 'float')}</div>
      <div class="sec"><span class="sec-label">Weights (put them down low)</span>${partCards(P => P.kind === 'weight')}</div>
      ${partList(isTW) ? `<div class="sec"><span class="sec-label">On your ROV</span>${partList(isTW)}</div>` : ''}
      <div class="row"><button class="btn" data-act="tank">Test it in the tank</button></div>`;
  }

  function powerStep() {
    return stepHead(6, 'Power and wiring', 'Choose how your ROV gets power from the 12 V battery on the pool deck. Anything marked “fails inspection” would keep you out of the pool on competition day.') + powerTab();
  }

  function checkStep() {
    const ins = insView(), b = Design.bounds(design);
    const sz = b.size.map(v => Math.round(v));
    const row = i => `<li><span class="id">${esc(i.id)}</span><span>${esc(i.text)}${i.why ? `<span class="why">${esc(i.why)}</span>` : ''}${i.kind === 'self' ? `<label class="chk" style="margin-top:4px"><input type="checkbox" data-self="${i.id}" ${i.pass ? 'checked' : ''}> We checked this on our real ROV</label>` : ''}</span><span class="pill ${i.pass ? 'pass' : i.kind === 'warn' ? 'warn' : 'fail'}">${i.pass ? 'Pass' : i.kind === 'warn' ? 'Warning' : 'Fix'}</span></li>`;
    const shop = `<div class="card"><span class="sec-label">Shop sheet</span><p class="note">Plans for building your real ROV: drawings, the pipe cut list, where each part goes, and the wiring.</p><div class="row"><button class="btn go" data-act="shopSheet">View shop sheet</button></div></div>`;
    if (opts.junior) return stepHead(7, 'Ready to dive?', '') + `<div class="sec"><ul class="insp">${ins.items.map(row).join('')}</ul></div>
      <div class="card"><dl class="kv"><dt>Build cost</dt><dd>${fmt$(ins.budget.total)} of $2,000</dd><dt>Size</dt><dd>${sz.join(' × ')} in</dd></dl></div>${shop}`;
    return stepHead(7, 'Inspection and budget', 'This is the official 2027 inspection form plus a few build checks. Fix anything red, then take your ROV to the pool.') + shop + `
      <div class="card"><dl class="kv"><dt>Size (W × H × L)</dt><dd>${sz.join(' × ')} in ${Math.max(...sz) <= 24 ? '· fits the drag race' : '· too big for the drag race'}</dd><dt>Full-power current</dt><dd>${Design.fullPowerAmps(design).toFixed(1)} A</dd><dt>Build cost</dt><dd>${fmt$(ins.budget.total)} of $2,000</dd></dl></div>
      <div class="sec"><span class="sec-label">2027 Underwater IVD inspection form</span><ul class="insp">${ins.items.filter(i => i.kind === 'rule' || i.kind === 'self').map(row).join('')}</ul></div>
      <div class="sec"><span class="sec-label">Build checks</span><ul class="insp">${ins.items.filter(i => i.kind === 'build' || i.kind === 'warn').map(row).join('')}</ul></div>
      <details><summary>Budget: ${fmt$(ins.budget.total)}</summary><div style="margin-top:8px">${budgetTab(ins.budget)}</div></details>`;
  }

  function powerTab() {
    const E = design.elec;
    const rows = Object.entries(ELECTRICAL).map(([k, def]) => {
      const o = def.options[E[k]];
      return `<label class="sec" style="gap:4px"><span class="row between"><span class="sec-label">${def.label}${def.rule ? ' · rule ' + def.rule : ''}</span>${o.pass ? '' : '<span class="pill fail">fails inspection</span>'}</span>
        <select class="inp" data-elec="${k}">${Object.entries(def.options).map(([ok, oo]) => `<option value="${ok}" ${E[k] === ok ? 'selected' : ''}>${esc(oo.name)}${oo.price ? ' · ' + fmt$(oo.price) : ''}</option>`).join('')}</select>
        ${o.pass ? '' : `<span class="note" style="color:var(--warn)">${esc(o.why)}</span>`}</label>`;
    }).join('');
    const opt = k => ELECTRICAL[k].options[E[k]];
    const amps = Design.fullPowerAmps(design);
    const motors = design.parts.filter(p => PARTS[p.type] && PARTS[p.type].kind === 'thruster').length;
    const rT = opt('gauge').ohmPerFt * (opt('tether').ft + 3) * 2 + opt('battery').rOhm;
    const vAt = Math.max(0, opt('battery').volts - amps * rT);
    const thrustPct = Math.min(115, (vAt / 12) ** 2 * 100);
    const fuseA = opt('fuse').amps;
    return `<div class="card">
        <span class="sec-label">Electrical check, all motors at full power</span>
        <dl class="kv">
          <dt>Motors</dt><dd>${motors}</dd>
          <dt>Total current</dt><dd>${amps.toFixed(1)} A ${amps > fuseA ? '<span class="pill fail">over the fuse</span>' : ''}</dd>
          <dt>Fuse</dt><dd>${fuseA > 100 ? 'none' : fuseA + ' A'}</dd>
          <dt>Tether + battery resistance</dt><dd>${rT.toFixed(3)} Ω</dd>
          <dt>Voltage at the motors</dt><dd>${vAt.toFixed(1)} V</dd>
          <dt>Thrust compared with 12 V</dt><dd>${thrustPct.toFixed(0)}%</dd>
        </dl>
        <p class="note">Voltage drop = current × resistance. A longer or thinner tether loses more voltage, and bilge motors push with roughly (volts ÷ 12)² of their rated thrust. If the current goes over the fuse rating for more than a moment, the fuse blows and the ROV goes dead until you replace it.</p>
      </div>${rows}`;
  }

  function budgetTab(B) {
    const groups = U.BUDGET_LINES.map(line => {
      const rs = B.rows.filter(r => r.line === line);
      if (!rs.length) return '';
      return `<tr class="group"><td colspan="3">${esc(line)}</td><td class="n">${fmt$(B.byLine[line])}</td></tr>` +
        rs.map(r => `<tr><td>${esc(r.desc)}${r.note ? `<br><span class="note">${esc(r.note)}</span>` : ''}</td><td class="n">${r.qty}</td><td class="n">${fmt$(r.each)}</td><td class="n">${fmt$(r.total)}</td></tr>`).join('');
    }).join('');
    const pct = Math.min(100, B.total / 20);
    return `<div class="sec"><div class="row between"><b>${fmt$(B.total)} of $2,000</b><span class="note">${B.total > 2000 ? 'Over budget by ' + fmt$(B.total - 2000) : fmt$(2000 - B.total) + ' left'}</span></div>
      <div class="bar ${B.total > 2000 ? 'over' : ''}"><i style="width:${pct}%"></i></div></div>
      <p class="note">Full retail prices, as rule 2.2 requires, even for donated parts or parts from team stock. Prices here are typical; check real Amazon prices (rule 2.3) before you submit. Tools, spares and chargers that are not on the ROV do not count (rule 2.6).</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Each</th><th class="n">Total</th></tr></thead><tbody>${groups}
      <tr class="total"><td colspan="3">Build total</td><td class="n">${fmt$(B.total)}</td></tr></tbody></table></div>
      <div class="row"><button class="btn" data-act="budgetCsv">Download budget (CSV)</button><span class="note">Same columns as the Square One budget template.</span></div>`;
  }

  function trimSvg(mp) {
    const pitch = mp.sep > 0.002 ? Math.max(-40, Math.min(40, mp.pitch)) : 0;
    const unstable = mp.sep <= 0.002;
    const cm = mp.cm, cb = mp.cb;
    const sx = z => 55 + z * 220, sy = y => 62 - (y - cm[1]) * 220;
    return `<svg id="trimSvg" viewBox="0 0 110 110" role="img" aria-label="Side view of how the ROV sits">
      <rect x="0" y="0" width="110" height="110" rx="10" style="fill:var(--panel-2);stroke:var(--line)"/>
      <path d="M0 18 Q 14 14 28 18 T 56 18 T 84 18 T 112 18" style="fill:none;stroke:var(--accent)" stroke-width="1.5"/>
      <g transform="rotate(${-pitch} 55 62)">
        <rect x="22" y="44" width="66" height="34" rx="3" style="fill:none;stroke:var(--ink)" stroke-width="2.5"/>
        <text x="16" y="66" font-size="9" style="fill:var(--muted)" text-anchor="middle">front</text>
        <circle cx="${sx(cb[2] - cm[2] + 0) - 0}" cy="${sy(cb[1])}" r="5" fill="#1b7fd1"/>
        <circle cx="55" cy="62" r="5" fill="#e0362c"/>
      </g>
      <text x="55" y="104" font-size="9.5" style="fill:${unstable ? 'var(--warn)' : 'var(--muted)'}" text-anchor="middle">${unstable ? 'unstable: will flip' : (pitch >= 0 ? 'nose up ' : 'nose down ') + Math.abs(pitch).toFixed(0) + '°'}</text>
    </svg>`;
  }

  // Build panel events
  $('#sideHead').addEventListener('click', e => {
    const s = e.target.closest('[data-step]'); if (s && mode === 'build') return setStep(s.dataset.step);
    const t = e.target.closest('[data-tab]');
    if (t) { pilotTab = t.dataset.tab; renderPilot(); return; }
    const a = e.target.closest('[data-act]'); if (a) act(a.dataset.act, a);
  });
  $('#sideBody').addEventListener('click', e => {
    const t = e.target;
    const st = t.closest('[data-step]'); if (st) return setStep(st.dataset.step);
    const pl = t.closest('[data-place]'); if (pl) { if (placing && placing.type === pl.dataset.place) return stopPlacing(); return startPlacing(pl.dataset.place); }
    const ly = t.closest('[data-layout]'); if (ly) return applyMotorLayout(ly.dataset.layout, motorType);
    const mt = t.closest('[data-mtype]'); if (mt) { motorType = mt.dataset.mtype; store.set('motorType', motorType); return renderBuild(); }
    const ln = t.closest('[data-len]'); if (ln) { pipeLen = +ln.dataset.len; store.set('pipeLen', pipeLen); return renderBuild(); }
    const dr = t.closest('[data-dir]'); if (dr) return setPartDir(dr.dataset.dir);
    const qy = t.closest('[data-qty]'); if (qy) { const p = selPart(); if (p) { commit(); p.qty = Math.max(1, Math.min(12, (p.qty || 1) + +qy.dataset.qty)); changed(); } return; }
    const dp = t.closest('[data-delpart]'); if (dp) { commit(); design.parts = design.parts.filter(p => p.id !== dp.dataset.delpart); if (sel && sel.id === dp.dataset.delpart) sel = null; return changed(); }
    const pa = t.closest('[data-part]'); if (pa) { sel = { kind: 'part', id: pa.dataset.part }; return afterSelect(); }
    const nd = t.closest('[data-nudge]'); if (nd) { const [ax, d] = nd.dataset.nudge.split(',').map(Number); return nudge(ax, d); }
    const pr = t.closest('[data-preset]'); if (pr) return choosePreset(pr.dataset.preset);
    const ms = t.closest('[data-mission]'); if (ms) return loadMission(ms.dataset.mission);
    const sw = t.closest('[data-sw]'); if (sw) return toggleSwitch(sw.dataset.sw);
    const a = t.closest('[data-act]'); if (a) return act(a.dataset.act, a);
  });
  let boxSnap = null;
  $('#sideBody').addEventListener('input', e => {
    const t = e.target, p = selPart();
    if (t.id === 'pTilt' && p) { p.tilt = +t.value; t.previousElementSibling.textContent = p.tilt + '°'; rebuildBuilder(); return; }
    if (t.dataset.box && design.box) {
      if (!boxSnap) boxSnap = JSON.stringify(design);
      const B = Object.assign({}, design.box, { [t.dataset.box]: +t.value });
      Design.resizeBox(design, B);
      const b = t.parentElement.querySelector('b'); if (b) b.innerHTML = `${t.value} in <small>(${Math.round(t.value * 2.54)} cm)</small>`;
      rebuildBuilder();
    }
  });
  $('#sideBody').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.box) { if (boxSnap) { undoStack.push(boxSnap); redoStack = []; boxSnap = null; } sel = null; return changed(); }
    if (t.dataset.boxopt) return setBoxDims({ [t.dataset.boxopt]: t.checked });
    if (t.id === 'mirror') { mirror = t.checked; store.set('mirror', mirror); return; }
    if (t.name === 'seal') { commit(); design.sealed = t.value === '1'; return changed(); }
    if (t.dataset.elec) { commit(); design.elec[t.dataset.elec] = t.value; return changed(); }
    if (t.dataset.self) { commit(); design.selfCheck[t.dataset.self] = t.checked; return changed(); }
    const p = selPart();
    if (t.id === 'pTilt' && p) { const v = p.tilt; p.tilt = v; commit(); return changed(); }
    if (t.dataset.rec !== undefined) { recSeries[t.value] = t.checked; drawChart(); }
  });

  function setHint() {
    const h = $('#hint'); if (!h) return;
    if (mode !== 'build') return;
    h.textContent = placing ? 'Click the side of a pipe to place the part · Esc to cancel · drag to turn the view'
      : buildStep === 'frame' ? 'Click a blue joint, then an orange arrow to add a pipe · drag to turn the view · scroll to zoom'
      : 'Drag a part to move it · click a part to edit it · drag empty space to turn the view · scroll to zoom';
  }

  function choosePreset(k) {
    modal('Start from “' + Design.PRESETS[k].label + '”?', `<p>This replaces the ROV you are building. You can undo it with ↶.</p>`, [
      { label: 'Cancel' }, { label: 'Replace my ROV', cls: 'go', run: () => { commit(); const keepE = design.elec; design = Design.PRESETS[k].make(); design.elec = Object.assign({}, keepE); $('#rovName').value = design.name; sel = null; changed(); fitBuilder(); } }]);
  }

  function act(name, el) {
    switch (name) {
      case 'undo': return undo();
      case 'redo': return redo();
      case 'del': return deleteSelected();
      case 'mirrorPart': return mirrorPart();
      case 'budgetCsv': return budgetCsv();
      case 'tank': setMode('pilot'); return loadMission('tank');
      case 'goPilot': return $('#modePilot').click();
      case 'goBuild': return setMode('build');
      case 'shopSheet': return openShopSheet();
      case 'logRun': return logRun();
      case 'drillAgain': return loadMission(M.def.id);
      case 'drillNext': { const nx = 'drill' + (M.def.drill + 1); return loadMission(MISSIONS[nx] ? nx : 'practice'); }
      case 'cancelPlace': return stopPlacing();
      case 'quickCam': return quickCamera();
      case 'autoTrim': return autoTrim();
      case 'toBox': { const b = Design.bounds(design); return setBoxDims({ w: Math.max(8, Math.min(20, Math.round(b.size[0] / 2) * 2 || 12)), h: 8, l: 14 }); }
      case 'startHeat': return startHeat();
      case 'endHeat': return endHeat('start');
      case 'doneMeasure': return endHeat('done');
      case 'submitAnswer': return submitAnswer();
      case 'practiceRun': return loadMission(M.def.id, { practice: true });
      case 'resetHeats': return resetHeats();
      case 'claw': return Missions.toggleClaw(M);
      case 'diver': return diverAssist();
      case 'fuse': return replaceFuse();
      case 'reset': return loadMission(M.def.id, { practice: !heat || !heat.running });
      case 'pilotSwitched': if (heat) { heat.pilotSwitched = true; } $('#banner').hidden = true; return;
      case 'recToggle': recording = !recording; return renderPilot();
      case 'recClear': samples = []; drawChart(); return;
      case 'recCsv': return dataCsv();
      default:
        if (name.startsWith('replay:')) { const [, id, hn] = name.split(':'); return openReplay(id, +hn); }
        if (name.startsWith('mact:')) { const a = M.def.actions[+name.slice(5)]; a && a.run(M); renderPilot(); }
    }
  }

  function budgetCsv() {
    const B = Design.bom(design);
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = [['Team Number:', $('#teamName').value], ['ROV:', $('#rovName').value], ['IVD Program:', 'Underwater IVD'], [], ['Item #', 'Description', 'Budget line', 'New/Used', 'Bought / From Stock / Donated', 'Qty', 'New Retail Value (each)', 'Total']];
    B.rows.forEach((r, i) => lines.push([i + 1, r.desc + (r.note ? ' (' + r.note + ')' : ''), r.line, 'New', 'Bought', r.qty, r.each.toFixed(2), r.total.toFixed(2)]));
    lines.push([], ['', 'Build total', '', '', '', '', '', B.total.toFixed(2)]);
    saveFile(slug($('#rovName').value) + '-budget.csv', lines.map(l => l.map(q).join(',')).join('\n'));
  }
  const slug = s => (String(s || 'rov').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rov');

  /* ---------------- pilot: missions and the loop ---------------- */
  let M = null, heat = null, pilotDirty = true, view = 'cam', camIdx = 0, camYaw = 0, camPitch = 0, camZoom = 1;
  const keys = new Set();
  let recording = true, samples = [], sampleT = 0;
  const recSeries = { depth: true, speed: true, amps: false, heading: false };

  function loadMission(id, o) {
    o = o || {};
    const def = MISSIONS[id];
    pWorld.clear();
    const pool = Missions.POOLS[def.pool];
    pWorld.add(World.buildPool(pool));
    const scene = new THREE.Group(); pWorld.add(scene);
    const rov = Physics.create(design);
    const offset = V3(...rov.mp.cm);
    const mesh = World.buildRov(design, { offset });
    pWorld.add(mesh);
    const prev = M && M.def.id === id ? M.state : null;
    M = {
      def, pool, scene, rov, mesh, state: {}, heat: null, start: def.start,
      env: { floorY: (x, z) => -pool.depth(Math.max(pool.z0, Math.min(pool.z1, z))), walls: { x0: pool.x0, x1: pool.x1, z0: pool.z0, z1: pool.z1 }, obstacles: [], anchor: V3(def.start.x, 0.3, 0.3) },
      event: pushEvent, sound: beep
    };
    if (id === 'drag') {
      const sz = Design.bounds(design).size;
      M.state.size = { ok: Math.max(...sz) <= 24, sz };
      if (prev && o.keepRound) { M.state.round = prev.round; M.state.results = prev.results; M.state.best = prev.best; }
      M.onRaceDone = (res, t) => {
        const d = progress.drag || {};
        if (t && res !== 'dq') d.bestTime = Math.min(d.bestTime || 999, t);
        d.rounds = Math.max(d.rounds || 0, M.state.best && M.state.best.rounds || 0);
        d.runs = (d.runs || 0) + 1;
        progress.drag = d; saveProgress();
        logTest('Drag race: ' + (Missions.DRAG_ROUNDS[Math.max(0, (M.state.round || 1) - 1)] || {}).name, res === 'win' ? `won in ${t.toFixed(2)} s` : res === 'dq' ? 'disqualified' : t ? `lost, ${t.toFixed(2)} s` : 'lost');
        setTimeout(() => { const keep = M.state; loadMission('drag', { keepRound: true }); }, 1800);
      };
    }
    def.setup(M);
    rov.onFuse = () => { pushEvent('Fuse blown! Too much current. Replace the fuse to continue.', 'bad'); beep('bad'); };
    Physics.place(rov, V3(def.start.x, def.start.y, def.start.z), def.start.heading);
    if (id === 'drag') { const rear = Missions.rearZ(M); rov.p.z += -0.012 - rear; }
    if (def.afterPlace) def.afterPlace(M);
    if (opts.junior) rov.elec.fuseA = 999; // junior mode: the fuse never blows
    M.maxSpeed = 0;
    if (def.drill) { M.state.t = 0; M.state.started = false; M.state.locked = !drillUnlocked(def.drill); M.state.missing = drillMissing(def); }
    heat = o.heat || null; M.heat = heat;
    pilotDirty = false;
    samples = []; sampleT = 0;
    const hasCam = rov.cameras.length > 0;
    if (heat && heat.running) view = hasCam ? 'cam' : 'chase';
    else if (!hasCam && view === 'cam') view = 'chase';
    if (id === 'drag') view = 'deck';
    if (def.views === 'cam' && hasCam) view = 'cam';
    camIdx = Math.min(camIdx, Math.max(0, rov.cameras.length - 1));
    $('#banner').hidden = true;
    renderViewButtons();
    renderPilot();
  }

  function saveProgress() { store.set('progress', progress); }

  function startHeat() {
    const def = M.def;
    const P = progress[def.id] || {};
    const used = (P.heats || []).filter(Boolean).length;
    if (def.heats && used >= def.heats) { toast('Both heats are used. Reset heats to start a new competition day.'); return; }
    const n = used + 1;
    const h = { n, t: 0, limit: def.heatSec, running: true, peeks: 0, divers: 0, pilotSwitched: false, bannerShown: false };
    loadMission(def.id, { heat: h });
    h.track = []; h.events = []; h.trackT = 1; h.items = Missions.mapItems(M);
    pushEvent(`Heat ${n} started. The clock is running.`, 'good');
    beep('go');
  }

  function endHeat(how) {
    if (!heat || !heat.running) return;
    heat.running = false;
    const def = M.def;
    const sc = def.score(M) || {};
    const P = progress[def.id] = progress[def.id] || {};
    if (def.id === 'hoop') {
      heat.awaitAnswer = true;
      pushEvent(how === 'time' ? 'Time! Enter your area answer now.' : 'Measuring done. Enter your area answer.', 'good');
    } else {
      const returned = how === 'start';
      const rec = { n: heat.n, task: sc.task, pen: sc.pen.reduce((a, r) => a + r.pts, 0), total: sc.total, elapsed: returned ? +heat.t.toFixed(1) : null, complete: !!sc.complete && returned && heat.t < heat.limit, returned, peeks: heat.peeks, divers: heat.divers, pilotSwitched: heat.pilotSwitched || heat.t < 420, at: new Date().toISOString(), rows: sc.rows.map(r => ({ label: r.label, count: r.count, pts: r.pts })) };
      P.heats = P.heats || [];
      P.heats[heat.n - 1] = rec;
      saveProgress();
      saveReplay(def.id, heat, rec.total, returned ? heat.t : null);
      logTest(`${def.short} heat ${heat.n}`, `${rec.total} points${returned ? ' in ' + mmss(heat.t) : ', time ran out'}`);
      pushEvent(`Heat ${heat.n} over: ${rec.total} points${returned ? ' in ' + mmss(heat.t) : ''}.${rec.complete ? ' Time bonus eligible!' : ''}`, 'good');
      beep('flag');
    }
    renderPilot();
  }

  function submitAnswer() {
    const v = parseFloat(($('#ansIn') || {}).value);
    if (!isFinite(v) || v <= 0) { toast('Type your area in square meters, for example 0.25'); return; }
    M.state.answer = Math.round(v * 100) / 100;
    const sc = MISSIONS.hoop.score(M);
    if (heat && heat.awaitAnswer) {
      heat.awaitAnswer = false;
      progress.hoop = { answer: M.state.answer, known: +M.state.hoopArea.toFixed(5), diam: M.state.hoopD, score: sc.total, at: new Date().toISOString(), heats: [{ n: 1 }] };
      saveProgress();
      saveReplay('hoop', heat, sc.total, heat.t);
      logTest('#1 Hoop heat', `${sc.total} / 100 (answer ${M.state.answer.toFixed(2)} m², actual ${M.state.hoopArea.toFixed(3)})`);
      pushEvent(`Score: ${sc.total} / 100`, 'good');
    }
    renderPilot();
  }

  function resetHeats() {
    modal('Start a new competition day?', `<p>This clears your heat scores for <b>${esc(M.def.title)}</b> so you can run the heats again. Your best results are not kept.</p>`, [{ label: 'Cancel' }, {
      label: 'Clear heats', cls: 'stop', run: () => {
        const old = progress[M.def.id] || {};
        progress[M.def.id] = { days: (old.days || 1) + 1 };
        saveProgress(); renderPilot();
      }
    }]);
  }

  function diverAssist() {
    if (heat && heat.running) { heat.divers++; pushEvent('Diver assistance: −20', 'bad'); }
    const r = M.rov;
    r.qn.setFromAxisAngle(V3(0, 1, 0), new THREE.Euler().setFromQuaternion(r.qn, 'YXZ').y);
    r.v.set(0, 0, 0); r.w.set(0, 0, 0);
    // move clear of the apparatus
    for (let k = 0; k < 20; k++) {
      let hit = M.env.obstacles.find(o => Physics.closestOnSeg(r.p, o.a, o.b).distanceTo(r.p) < 0.4);
      if (!hit) break;
      const c = Physics.closestOnSeg(r.p, hit.a, hit.b);
      const away = r.p.clone().sub(c); away.y = 0; if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
      r.p.addScaledVector(away.normalize(), 0.1);
    }
    r.p.y = Math.min(r.p.y + 0.2, -0.3);
    renderPilot();
  }
  function replaceFuse() {
    const r = M.rov;
    if (!r.elec.blown) { toast('The fuse is fine.'); return; }
    if (heat && heat.running) {
      pushEvent('Replacing the fuse… (15 s, the clock keeps running)');
      heat.fuseWait = 15;
    } else { r.elec.blown = false; r.elec.heat = 0; pushEvent('New fuse in.'); }
    renderPilot();
  }

  function toggleSwitch(id) {
    const t = M.rov.thrusters.find(x => x.id === id); if (!t) return;
    t.manual = t.manual === 0 ? 1 : t.manual === 1 ? -1 : 0;
  }

  // events feed
  function pushEvent(msg, cls) {
    if (heat && heat.running && heat.events) heat.events.push({ t: +heat.t.toFixed(1), msg: String(msg), cls: cls || '' });
    const f = $('#feed');
    const d = document.createElement('div'); d.textContent = msg; if (cls) d.className = cls;
    f.appendChild(d);
    while (f.children.length > 4) f.removeChild(f.firstChild);
    setTimeout(() => d.remove(), 6500);
  }

  // sound
  let actx = null;
  function beep(kind) {
    if (!opts.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = { ring: [880, 0.08], flag: [660, 0.12, 990, 0.18], go: [1046, 0.3], beep: [523, 0.15], bad: [196, 0.35] }[kind] || [700, 0.1];
      let t = actx.currentTime;
      for (let i = 0; i < notes.length; i += 2) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = notes[i]; o.type = kind === 'bad' ? 'sawtooth' : 'sine';
        g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + notes[i + 1]);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + notes[i + 1]);
        t += notes[i + 1];
      }
    } catch (e) { /* audio unavailable */ }
  }

  /* ---------------- views ---------------- */
  function viewAllowed(v) {
    if (!M) return false;
    if (v === 'cam' || v === 'cam2') return M.rov.cameras.length > (v === 'cam2' ? 1 : 0);
    if (M.def.views === 'cam' && M.rov.cameras.length) return false;
    if (v === 'chase') return !(M.def.views === 'heat' && heat && heat.running);
    return true;
  }
  function setView(v) {
    if (!viewAllowed(v)) { toast(M.def.views === 'cam' ? 'This drill is camera only, like a real heat.' : v === 'chase' ? 'During a heat the pilot sees only the ROV camera.' : 'This ROV has no camera there.'); return; }
    if (v === 'deck' && view !== 'deck' && M.def.views === 'heat' && heat && heat.running) { heat.peeks++; pushEvent('Pilot looked at the pool: −20', 'bad'); beep('bad'); }
    if (v === 'cam2') { view = 'cam'; camIdx = 1; } else { if (v === 'cam') camIdx = 0; view = v; }
    camYaw = 0; camPitch = 0;
    renderViewButtons();
  }
  function renderViewButtons() {
    const vb = $('#vbtns');
    if (mode === 'build') {
      vb.innerHTML = `<button class="vbtn" data-bv="undo" ${undoStack.length ? '' : 'disabled style="opacity:.45"'} title="Undo (Ctrl+Z)">↶ Undo</button><button class="vbtn" data-bv="redo" ${redoStack.length ? '' : 'disabled style="opacity:.45"'} title="Redo (Ctrl+Y)">↷ Redo</button><button class="vbtn" data-bv="fit">Fit</button><button class="vbtn" data-bv="front">Front</button><button class="vbtn" data-bv="side">Side</button><button class="vbtn" data-bv="top">Top</button>`;
      return;
    }
    const inHeat = heat && heat.running && M.def.views === 'heat';
    const n = M ? M.rov.cameras.length : 0;
    const b = (v, label, extra) => `<button class="vbtn ${extra || ''}" data-v="${v}" aria-pressed="${(v === 'cam' && view === 'cam' && camIdx === 0) || (v === 'cam2' && view === 'cam' && camIdx === 1) || (v === view && v !== 'cam')}" ${viewAllowed(v) ? '' : 'disabled style="opacity:.4"'}>${label}</button>`;
    vb.innerHTML = (n ? b('cam', 'ROV camera') : '') + (n > 1 ? b('cam2', 'Camera 2') : '') + b('deck', 'Deck view', inHeat ? 'cost' : '') + (inHeat ? '' : b('chase', 'Chase')) +
      (M.def.views === 'cam' ? '' : `<button class="vbtn" data-v="map" aria-pressed="${opts.map}" title="Spotter map: what your teammates on the deck can see">Map</button>`);
  }
  $('#vbtns').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.bv) {
      if (b.dataset.bv === 'undo') return undo();
      if (b.dataset.bv === 'redo') return redo();
      if (b.dataset.bv === 'fit') fitBuilder();
      else { fitBuilder(); if (b.dataset.bv === 'front') { orbit.th = 0; orbit.ph = Math.PI / 2 - 0.05; } if (b.dataset.bv === 'side') { orbit.th = Math.PI / 2; orbit.ph = Math.PI / 2 - 0.05; } if (b.dataset.bv === 'top') { orbit.th = 0; orbit.ph = 0.09; } }
      return;
    }
    if (b.dataset.v === 'map') { opts.map = !opts.map; store.set('opts', opts); renderViewButtons(); return; }
    setView(b.dataset.v);
  });

  /* ---------------- input ---------------- */
  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };
  window.addEventListener('keydown', e => {
    if (!$('#modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
    if (typing()) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((e.ctrlKey || e.metaKey) && k === 'z' && mode === 'build') { e.preventDefault(); return undo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y' && mode === 'build') { e.preventDefault(); return redo(); }
    if (mode === 'build') {
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (k === 'Escape') { if (placing) stopPlacing(); else { sel = null; afterSelect(); } }
      else if (k === 'r') turnPart();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' '].includes(k)) e.preventDefault();
    keys.add(k);
    if (e.repeat) return;
    if (k === 'g') Missions.toggleClaw(M);
    else if (k === 'c') { if (M.rov.cameras.length > 1 && view === 'cam') setView(camIdx === 0 ? 'cam2' : 'cam'); else setView('cam'); }
    else if (k === 'v') setView('deck');
    else if (k === 'm') { opts.map = !opts.map; store.set('opts', opts); renderViewButtons(); }
    else {
      M.def.actions.forEach((a, i) => { if (a.key.toLowerCase() === k.toLowerCase() && (!a.show || a.show(M))) { a.run(M); renderPilot(); } });
    }
  });
  window.addEventListener('keyup', e => { keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key); });
  window.addEventListener('blur', () => keys.clear());
  const touchHeld = new Set();
  $('#touch').addEventListener('pointerdown', e => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    e.preventDefault(); b.setPointerCapture(e.pointerId);
    const k = b.dataset.k;
    if (k === 'claw') return Missions.toggleClaw(M);
    if (k === 'hang') return Missions.hangRing(M) || pushEvent('Put the prong tip right on a J hook first.');
    if (k === 'give') return Missions.handToTeammate(M);
    if (k === 'cam') return setView(view === 'cam' && M.rov.cameras.length > 1 && camIdx === 0 ? 'cam2' : 'cam');
    touchHeld.add(k); b.classList.add('on');
  });
  const tUp = e => { const b = e.target.closest('button[data-k]'); if (!b) return; touchHeld.delete(b.dataset.k); b.classList.remove('on'); };
  $('#touch').addEventListener('pointerup', tUp); $('#touch').addEventListener('pointercancel', tUp);

  function readControls() {
    const c = { surge: 0, sway: 0, heave: 0, yaw: 0 };
    const k = x => keys.has(x);
    c.surge = (k('w') || k('ArrowUp') || touchHeld.has('fwd') ? 1 : 0) - (k('s') || k('ArrowDown') || touchHeld.has('back') ? 1 : 0);
    c.yaw = (k('d') || k('ArrowRight') || touchHeld.has('yawR') ? 1 : 0) - (k('a') || k('ArrowLeft') || touchHeld.has('yawL') ? 1 : 0);
    c.sway = (k('e') || touchHeld.has('swayR') ? 1 : 0) - (k('q') || touchHeld.has('swayL') ? 1 : 0);
    c.heave = (k('r') || k('PageUp') || touchHeld.has('up') ? 1 : 0) - (k('f') || k('PageDown') || touchHeld.has('down') ? 1 : 0);
    // gamepad: left stick drive and turn, right stick strafe and up/down
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const dz = v => Math.abs(v) < 0.18 ? 0 : v;
      c.surge += -dz(gp.axes[1] || 0); c.yaw += dz(gp.axes[0] || 0); c.sway += dz(gp.axes[2] || 0); c.heave += -dz(gp.axes[3] || 0);
      gp.buttons.forEach((b, i) => {
        const was = padPrev[i]; padPrev[i] = b.pressed;
        if (b.pressed && !was) {
          if (i === 0) Missions.toggleClaw(M);
          if (i === 1) Missions.hangRing(M) || pushEvent('Put the prong tip right on a J hook first.');
          if (i === 2) Missions.handToTeammate(M);
          if (i === 3) setView(view === 'cam' && M.rov.cameras.length > 1 && camIdx === 0 ? 'cam2' : 'cam');
        }
      });
      if (gp.buttons[6]) c.heave -= gp.buttons[6].value; if (gp.buttons[7]) c.heave += gp.buttons[7].value;
      break;
    }
    for (const x in c) c[x] = Math.max(-1, Math.min(1, c[x]));
    return c;
  }
  const padPrev = [];

  /* ---------------- frame loop ---------------- */
  let last = performance.now(), acc = 0, uiT = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    resize();
    if (mode === 'build') {
      placeBCam();
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, lastW, lastH);
      renderer.render(bScene, bCam);
      renderCamPreview();
    } else if (M) {
      acc += dt;
      const h = 1 / 120;
      const ctl = readControls();
      Object.assign(M.rov.cmd, ctl);
      if (heat && heat.fuseWait > 0) { heat.fuseWait -= dt; if (heat.fuseWait <= 0) { M.rov.elec.blown = false; M.rov.elec.heat = 0; pushEvent('New fuse in. Go!', 'good'); } }
      while (acc >= h) {
        M.def.step(M, h);
        Physics.step(M.rov, h, M.env);
        acc -= h;
      }
      const hs = Math.hypot(M.rov.v.x, M.rov.v.z); if (hs > M.maxSpeed) M.maxSpeed = hs;
      if (M.def.drill && !M.state.locked && !M.state.missing && !M.state.recorded) {
        if (!M.state.started && (ctl.surge || ctl.sway || ctl.heave || ctl.yaw)) M.state.started = true;
        if (M.state.started) M.state.t += dt;
        if (M.state.done) finishDrill();
      }
      if (heat && heat.running) {
        heat.t += dt;
        heat.trackT += dt;
        if (heat.track && heat.trackT >= 0.5) {
          heat.trackT = 0;
          const T = Physics.telemetry(M.rov);
          heat.track.push([Math.round(heat.t * 10), Math.round(M.rov.p.x * 100), Math.round(M.rov.p.z * 100), Math.round(T.depth * 100), Math.round(T.heading)]);
        }
        if (M.def.heats === 2 && heat.t >= 420 && !heat.bannerShown) {
          heat.bannerShown = true;
          showBanner('7:00 — switch pilots now. No one may pilot for more than half a heat.', 'Pilots switched', 'pilotSwitched');
          beep('beep');
        }
        if (heat.t >= heat.limit) { endHeat('time'); }
      }
      // sample data
      sampleT += dt;
      if (recording && sampleT >= 0.1) {
        sampleT = 0;
        const T = Physics.telemetry(M.rov);
        samples.push({ t: +(heat ? heat.t : M.rov.t).toFixed(2), depth: +T.depth.toFixed(3), speed: +T.speed.toFixed(3), amps: +T.amps.toFixed(2), heading: +T.heading.toFixed(1), volts: +T.volts.toFixed(2) });
        if (samples.length > 3000) samples.shift();
      }
      updatePoolVisuals(dt);
      renderer.render(pScene, pCam);
      uiT += dt;
      if (uiT > 0.2) { uiT = 0; updatePilotLive(); }
    }
    requestAnimationFrame(frame);
  }

  // In the camera step, show what the pilot will see in a corner of the 3D view
  function renderCamPreview() {
    const lbl = $('#pipLabel');
    const c = buildStep === 'camera' && !placing ? (design.parts.find(p => sel && p.id === sel.id && PARTS[p.type].kind === 'camera') || design.parts.find(p => PARTS[p.type].kind === 'camera')) : null;
    if (!c) { lbl.hidden = true; return; }
    const pw = Math.round(Math.min(lastW * 0.42, 340)), ph = Math.round(pw * 0.75);
    const x = lastW - pw - 10, y = 10;
    pipCam.position.set(...c.at.map(v => v * IN));
    pipCam.rotation.set((c.tilt || 0) * Math.PI / 180, 0, 0, 'YXZ');
    pipCam.translateZ(-0.05);
    pipCam.aspect = pw / ph; pipCam.updateProjectionMatrix();
    bMarkers.visible = false;
    const bg = bScene.background; bScene.background = new THREE.Color(isDark() ? 0x0d3a46 : 0x9ccfdb);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, pw, ph); renderer.setViewport(x, y, pw, ph);
    renderer.render(bScene, pipCam);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, lastW, lastH);
    bScene.background = bg; bMarkers.visible = true;
    lbl.hidden = false;
    lbl.style.right = '10px'; lbl.style.bottom = (10 + ph + 4) + 'px'; lbl.style.width = pw + 'px';
    lbl.textContent = `What the pilot sees · ${PARTS[c.type].short} · tilt ${c.tilt || 0}°`;
  }

  let lastW = 0, lastH = 0;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(10, Math.round(r.width)), h = Math.max(10, Math.round(r.height));
    if (w !== lastW || h !== lastH) {
      lastW = w; lastH = h; renderer.setSize(w, h, false);
      bCam.aspect = pCam.aspect = w / h; bCam.updateProjectionMatrix(); pCam.updateProjectionMatrix();
    }
  }

  function updatePoolVisuals(dt) {
    const r = M.rov, mesh = M.mesh;
    mesh.position.copy(r.p); mesh.quaternion.copy(r.qn);
    // spin props and move claw jaws
    r.thrusters.forEach(t => { const pm = mesh.userData.parts[t.id]; if (pm && pm.userData.prop) pm.userData.prop.rotation.y += t.out * dt * 40; });
    r.tools.forEach(t => { const pm = mesh.userData.parts[t.id]; if (pm && pm.userData.jaws) { const o = t.closed ? 0.012 : 0.034; pm.userData.jaws[0].position.x += (-o - pm.userData.jaws[0].position.x) * 0.3; pm.userData.jaws[1].position.x += (o - pm.userData.jaws[1].position.x) * 0.3; } });
    // camera
    const hud = $('#hud');
    if (view === 'cam' && r.cameras[camIdx]) {
      const c = r.cameras[camIdx];
      pCam.fov = c.P.fov / camZoom * 0.9;
      pCam.position.copy(Physics.worldOf(r, c.pos));
      const q = r.qn.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V3(1, 0, 0), c.tilt));
      pCam.quaternion.copy(q);
      // keep the camera body out of view by stepping a little forward
      pCam.position.add(V3(0, 0, -0.05).applyQuaternion(q));
    } else if (view === 'deck') {
      pCam.fov = 55 / camZoom;
      const s = M.start;
      const base = M.def.id === 'drag' ? V3(s.x + 1.25, 2.4, 1.4) : V3(s.x + 1.2, 1.7, 0.9);
      pCam.position.copy(base);
      pCam.lookAt(r.p);
      pCam.rotateY(camYaw); pCam.rotateX(camPitch);
    } else {
      pCam.fov = 65;
      const back = V3(0, 0.35, 1.1 * camZoom).applyAxisAngle(V3(1, 0, 0), -camPitch * 0.8).applyAxisAngle(V3(0, 1, 0), camYaw);
      const e = new THREE.Euler().setFromQuaternion(r.qn, 'YXZ');
      back.applyAxisAngle(V3(0, 1, 0), e.y);
      pCam.position.copy(r.p).add(back);
      pCam.lookAt(r.p);
    }
    pCam.updateProjectionMatrix();
    const under = pCam.position.y < 0;
    const murk = opts.murky ? 0.42 : 0.14;
    fogUnder.density = murk;
    pScene.fog = under ? fogUnder : fogAir;
    pScene.background = under ? bgUnder : bgAir;
    snow.visible = under; snow.position.copy(pCam.position);
    // HUD
    const T = Physics.telemetry(r);
    const camDepth = Math.max(0, -pCam.position.y);
    const clock = heat ? mmss(heat.t) : mmss(r.t);
    if (view === 'cam') {
      hud.hidden = false; $('#monitor').hidden = false;
      hud.innerHTML = `<span class="big">CAM ${camIdx + 1}</span><span>DEPTH ${(camDepth / 0.3048).toFixed(1)} ft</span><span>TEMP 80.2°F</span><span>HDG ${String(Math.round(T.heading)).padStart(3, '0')}°</span><span class="rec">● ${clock}</span>`;
    } else {
      $('#monitor').hidden = true;
      hud.hidden = false;
      hud.innerHTML = `<span class="big">${view === 'deck' ? 'DECK VIEW' : 'CHASE VIEW'}</span><span>ROV depth ${(T.depth / 0.3048).toFixed(1)} ft</span>`;
    }
    // map
    const mp = $('#map');
    const showMap = opts.map && M.def.views !== 'cam';
    mp.hidden = !showMap;
    if (showMap) drawMap(mp);
  }

  function drawMap(cv) {
    const g = cv.getContext('2d'), P = M.pool, W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const pad = 16;
    const sc = Math.min((W - 2 * pad) / (P.x1 - P.x0), (H - 2 * pad - 20) / (P.z1 - P.z0));
    const ox = W / 2 - (P.x0 + P.x1) / 2 * sc, oz = pad + 18 - P.z0 * sc;
    const X = x => ox + x * sc, Z = z => oz + z * sc;
    g.fillStyle = 'rgba(70,170,200,.35)'; g.fillRect(X(P.x0), Z(P.z0), (P.x1 - P.x0) * sc, (P.z1 - P.z0) * sc);
    g.strokeStyle = '#cfeaf0'; g.lineWidth = 2; g.strokeRect(X(P.x0), Z(P.z0), (P.x1 - P.x0) * sc, (P.z1 - P.z0) * sc);
    g.fillStyle = '#cfeaf0'; g.font = '600 18px Lexend, sans-serif'; g.textAlign = 'center'; g.fillText('SPOTTER MAP', W / 2, 20);
    if (P.finish != null) { g.strokeStyle = '#ff5a5a'; g.beginPath(); g.moveTo(X(P.x0), Z(P.finish)); g.lineTo(X(P.x1), Z(P.finish)); g.stroke(); }
    // start
    g.fillStyle = '#8cc63f'; g.fillRect(X(M.start.x) - 10, Z(P.z1) - 6, 20, 6);
    Missions.mapItems(M).forEach(it => {
      if (it.t === 'ring') { g.strokeStyle = it.c; g.lineWidth = 3; g.beginPath(); g.arc(X(it.x), Z(it.z), 4, 0, 7); g.stroke(); }
      if (it.t === 'tip') { g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(X(it.x) - 0.23 * sc, Z(it.z) - 0.17 * sc, 0.46 * sc, 0.33 * sc); }
      if (it.t === 'hoop') { g.strokeStyle = '#3fd66b'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(it.x) - 8, Z(it.z)); g.lineTo(X(it.x) + 8, Z(it.z)); g.stroke(); }
      if (it.t === 'reef') { g.strokeStyle = '#c7b3f0'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(it.x) - 9, Z(it.z)); g.lineTo(X(it.x) + 9, Z(it.z)); g.moveTo(X(it.x), Z(it.z) - 9); g.lineTo(X(it.x), Z(it.z) + 9); g.stroke(); }
      if (it.t === 'sac') { g.fillStyle = it.c; g.beginPath(); g.arc(X(it.x), Z(it.z), 6, 0, 7); g.fill(); }
      if (it.t === 'ghost') { g.fillStyle = '#ff8a2a'; g.fillRect(X(it.x) - 6, Z(it.z) - 8, 12, 16); }
    });
    // tether
    const r = M.rov, a = M.env.anchor;
    g.strokeStyle = r.tetherTight ? '#ff5a5a' : 'rgba(255,230,120,.8)'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(X(a.x), Z(P.z1)); g.lineTo(X(r.p.x), Z(r.p.z)); g.stroke(); g.setLineDash([]);
    // ROV
    const hd = Physics.telemetry(r).heading * Math.PI / 180;
    g.save(); g.translate(X(r.p.x), Z(r.p.z)); g.rotate(hd);
    g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(-7, 8); g.closePath(); g.fill(); g.restore();
  }

  function showBanner(text, btn, actName) {
    const b = $('#banner');
    b.className = 'ov banner';
    b.innerHTML = `<span>${esc(text)}</span>${btn ? `<button class="btn small go" data-act="${actName}">${esc(btn)}</button>` : ''}`;
    b.hidden = false;
    setTimeout(() => { if (heat && heat.bannerShown) b.hidden = true; }, 30000);
  }
  $('#banner').addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (a) act(a.dataset.act); });

  /* ---------------- pilot panel ---------------- */
  function heatState() {
    const def = M.def, P = progress[def.id] || {};
    const used = (P.heats || []).filter(Boolean).length;
    return { P, used };
  }

  function sheetHtml(sc) {
    if (!sc) return '';
    const def = M.def;
    if (sc.race) return `<div class="sheet"><h4>Drag race bracket</h4><table>${sc.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="n">${esc(r.note)}</td></tr>`).join('')}</table></div>`;
    if (sc.practice || def.id === 'hoop') {
      return `<div class="sheet"><h4>${def.id === 'hoop' ? 'Hula Hoop Hustle' : 'Practice pool'}${sc.total != null ? `<span>${sc.total} / 100</span>` : ''}</h4><table>${sc.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="n">${esc(r.note || '')}</td></tr>`).join('')}</table></div>`;
    }
    const t = heat ? mmss(heat.t) : '—';
    return `<div class="sheet"><h4>${esc(def.title.split(': ')[1])}<span>${heat ? 'Heat ' + heat.n : 'Practice run'}</span></h4>
      <h5>TASK POINTS</h5><table>${sc.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="n">${r.each} × ${r.count}</td><td class="n">${r.pts}</td></tr>`).join('')}
      <tr><td colspan="2"><b>Task subtotal</b></td><td class="n"><b>${sc.task}</b></td></tr></table>
      <h5>PENALTY POINTS</h5><table>${sc.pen.map(r => `<tr><td>${esc(r.label)}</td><td class="n">${r.count}</td><td class="n">${r.pts}</td></tr>`).join('')}</table>
      <table><tr class="grand"><td>Grand total</td><td class="n">${sc.total}</td></tr><tr><td colspan="2" class="note">Elapsed ${t}. ${esc(sc.bonusNote)}</td></tr></table></div>`;
  }

  function renderPilot() {
    if (!M) return;
    const def = M.def;
    $('#sideHead').innerHTML = `<div class="tabs" role="tablist">${[['mission', 'Mission'], ['controls', 'Control box'], ['data', 'Data']].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${pilotTab === k}">${l}</button>`).join('')}</div>`;
    const B = $('#sideBody');
    if (pilotTab === 'mission') B.innerHTML = missionTab();
    else if (pilotTab === 'controls') B.innerHTML = controlsTab();
    else { B.innerHTML = dataTab(); drawChart(); }
    renderViewButtons();
    updatePilotLive(true);
  }

  function missionTab() {
    const def = M.def;
    const ids = ['tank', 'practice', 'hoop', 'flag', 'carp', 'drag'];
    const list = drillListHtml() + `<span class="sec-label">Pool and challenges</span><div class="mlist">${ids.map(id => { const d = MISSIONS[id]; return `<button class="mcard ${d.heats || id === 'drag' ? 'challenge' : ''}" data-mission="${id}" aria-pressed="${id === def.id}"><b>${esc(d.short)}</b><span>${id === 'tank' ? 'Check trim' : id === 'practice' ? 'All apparatus, no clock' : d.heatSec ? (d.heatSec / 60) + ' min × ' + d.heats + ' heat' + (d.heats > 1 ? 's' : '') : 'Bracket of 3 races'}</span></button>`; }).join('')}</div>`;
    const { P, used } = heatState();
    let heatHtml = '';
    if (def.drill) heatHtml = `<div class="row"><button class="btn" data-act="drillAgain">Restart drill</button></div>`;
    else if (def.heats) {
      if (heat && heat.running) {
        const canEnd = def.id !== 'hoop' && Missions.atStart(M) && heat.t > 5;
        heatHtml = `<div class="card"><div class="heatbox"><span class="pill run">Heat ${heat.n} running</span><span class="clock" id="clk">${mmss(heat.t)}</span><span class="note">/ ${mmss(heat.limit)}</span></div>
          ${def.id === 'hoop' ? `<button class="btn go" data-act="doneMeasure">Done measuring: stop the heat</button>` : `<button class="btn go" data-act="endHeat" id="btnEnd" ${canEnd ? '' : 'disabled'}>Back at the start: stop the clock</button><span class="note" id="endNote">${canEnd ? 'Tell the judge you are done.' : 'Bring the ROV back to the surface at the starting wall to stop the clock.'}</span>`}</div>`;
      } else if (heat && heat.awaitAnswer || (def.id === 'hoop' && M.state.answer == null && heat)) {
        heatHtml = `<div class="card"><span class="sec-label">Your answer</span><p class="note">Area inside the hoop, in square meters, rounded to the nearest hundredth.</p>
          <div class="answer"><input class="inp" id="ansIn" inputmode="decimal" placeholder="0.00"> <span>m²</span><button class="btn go" data-act="submitAnswer">Submit to the scoring table</button></div>
          <p class="note">Area of a circle: A = π × r², where r is half the inside diameter. Check your units: 1 m = 100 cm.</p></div>`;
      } else {
        const done = def.heats && used >= def.heats;
        heatHtml = `<div class="card"><div class="row">${done ? `<span class="note">All ${def.heats} heat${def.heats > 1 ? 's' : ''} used.</span><button class="btn small" data-act="resetHeats">New competition day</button>` : `<button class="btn go" data-act="startHeat">Start heat ${used + 1}${def.heats > 1 ? ' of ' + def.heats : ''}</button>`}
          <button class="btn" data-act="practiceRun">${heat ? 'Practice run' : 'Restart practice'}</button></div>
          <p class="note">${heat ? '' : 'You are in a practice run: no clock, every view allowed. '}A heat uses a fresh random setup${def.views === 'heat' ? ' and the pilot sees only the ROV camera. Switching to the deck view counts as peeking (−20)' : ''}.</p></div>`;
        if (def.id === 'hoop' && !heat) heatHtml += `<div class="card"><span class="sec-label">Check a practice measurement</span><div class="answer"><input class="inp" id="ansIn" inputmode="decimal" placeholder="0.00"> <span>m²</span><button class="btn" data-act="submitAnswer">Check</button></div></div>`;
      }
    } else if (def.id !== 'drag') heatHtml = `<div class="row"><button class="btn" data-act="reset">Reset</button></div>`;
    const actions = def.actions.map((a, i) => (!a.show || a.show(M)) ? `<button class="btn ${a.label === 'Release' || a.label === 'Start race' ? 'go' : ''}" data-act="mact:${i}">${esc(a.label)}</button>` : '').join('');
    const hasClaw = M.rov.tools.some(t => t.type === 'claw');
    const res = resultsHtml(def.id);
    const sc = def.score(M);
    const sizeWarn = def.id === 'drag' && M.state.size && !M.state.size.ok ? `<p class="note" style="color:var(--warn)">This ROV is ${M.state.size.sz.map(v => Math.round(v)).join(' × ')} in. It must fit in a 24" cube to race. Make it smaller in Build, or build a separate drag racer.</p>` : '';
    return `${list}
      <div class="sec"><b>${esc(def.title)}</b><p class="mdesc">${esc(def.desc)}</p>${def.rules ? `<details><summary>Rules and scoring from the parameters</summary><ul class="rules">${def.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}${sizeWarn}</div>
      ${heatHtml}
      <div class="row">${actions}${hasClaw ? '<button class="btn" data-act="claw">Claw open/close (G)</button>' : ''}${def.id !== 'tank' && def.id !== 'drag' ? `<button class="btn" data-act="diver">${heat && heat.running ? 'Diver assist (−20)' : 'Diver assist'}</button>` : ''}</div>
      <div id="sheetBox">${def.drill ? drillSheet() : sheetHtml(sc)}</div>
      ${res}
      ${keysHtml()}`;
  }

  function resultsHtml(id) {
    const P = progress[id];
    if (!P) return '';
    if (id === 'hoop' && P.score != null) return `<div class="sec"><span class="sec-label">Official result</span><ul class="results"><li><span>Answer ${P.answer.toFixed(2)} m² (known ${P.known.toFixed(4)})</span><b>${P.score} / 100</b></li></ul>${replayBtn('hoop', 1)}</div>`;
    if (id === 'drag' && P.runs) return `<div class="sec"><span class="sec-label">Best results</span><ul class="results"><li><span>Best time</span><b>${P.bestTime && P.bestTime < 900 ? P.bestTime.toFixed(2) + ' s' : '—'}</b></li><li><span>Rounds won</span><b>${P.rounds || 0} of 3</b></li></ul></div>`;
    if (P.heats && P.heats.length) {
      const best = Math.max(...P.heats.filter(Boolean).map(h => h.total));
      return `<div class="sec"><span class="sec-label">Heats</span><ul class="results">${P.heats.map(h => h ? `<li><span>Heat ${h.n}: ${h.returned ? mmss(h.elapsed) : 'time ran out'}${h.complete ? ' · bonus eligible' : ''} ${replayBtn(id, h.n)}</span><b>${h.total}</b></li>` : '').join('')}<li><span>Best of 2 heats (raw score)</span><b>${best}</b></li></ul></div>`;
    }
    return '';
  }

  function replayBtn(id, n) { return store.get('replays', {})[id + '-' + n] ? `<button class="linkbtn" data-act="replay:${id}:${n}">Watch replay</button>` : ''; }

  function keysHtml() {
    return `<details><summary>Keyboard, gamepad and touch controls</summary><div class="keys" style="margin-top:8px">
      <kbd>W / S</kbd><span>forward / back (or ↑ ↓)</span><kbd>A / D</kbd><span>turn left / right (or ← →)</span>
      <kbd>Q / E</kbd><span>strafe left / right (needs a sideways thruster)</span><kbd>R / F</kbd><span>up / dive (or Page Up / Page Down)</span>
      <kbd>G</kbd><span>claw open / close</span><kbd>H</kbd><span>hang a ring on the J hook</span><kbd>T</kbd><span>hand rings or sacs to a teammate</span>
      <kbd>C</kbd><span>switch cameras</span><kbd>V</kbd><span>deck view (counts as a peek in a heat)</span><kbd>M</kbd><span>spotter map</span>
      <kbd>Gamepad</kbd><span>left stick drive and turn, right stick strafe and up/down, A claw, B hang, X hand off, Y camera</span></div>
      <p class="note" style="margin-top:6px">The simulator works out which motors to run from where you mounted them and which way they push, the way your control box wiring would.</p></details>`;
  }

  function controlsTab() {
    const r = M.rov;
    const pwm = r.elec.pwm;
    const sw = r.thrusters.map((t, i) => `<button class="sw" data-sw="${t.id}" id="sw-${t.id}" title="Click to flip this switch by hand: forward, reverse, off"><span class="lever"><i></i></span>${pwm ? '<span class="pbar"><i></i></span>' : ''}<small>M${i + 1} ${t.P.short}<br>${DIRS[design.parts.find(p => p.id === t.id).dir].label.toLowerCase()}</small></button>`).join('');
    return `<div class="cbox">
        <span class="lbl">Topside control box · ${pwm ? 'PWM speed control' : 'DPDT switches (full on / off / reverse)'}</span>
        <div class="sw-row">${sw || '<span>No thrusters on this ROV.</span>'}</div>
        <div class="meters"><div class="meter" id="mAmp"><span>Current</span><b>0.0 A</b></div><div class="meter" id="mVolt"><span>At motors</span><b>12.6 V</b></div><div class="meter" id="mFuse"><span>Fuse</span><b>OK</b></div></div>
        <div class="meters"><div class="meter" id="mDepth"><span>Depth</span><b>0.0 ft</b></div><div class="meter" id="mSpeed"><span>Speed</span><b>0.00</b></div><div class="meter" id="mTether"><span>Tether out</span><b>0 ft</b></div></div>
      </div>
      <div class="row"><button class="btn" data-act="fuse" id="btnFuse">Replace fuse</button><span class="note">Blown fuses take 15 s to replace during a heat.</span></div>
      <p class="note">Each switch lights up when the simulator runs that motor. Click a switch to lock it on by hand (forward, reverse, off), like flipping a real toggle. With DPDT switches a motor is always full power or off, so fine moves take short taps.</p>
      ${keysHtml()}`;
  }

  function dataTab() {
    return `<div class="sec"><span class="sec-label">Test data for your engineering journal</span>
      <p class="note">Recorded 10 times a second while you drive. Try a speed test: drive straight for 5 seconds and read the top speed. Change one thing on the ROV and test again.</p>
      <div class="row">${Object.keys(recSeries).map(k => `<label class="chk"><input type="checkbox" data-rec value="${k}" ${recSeries[k] ? 'checked' : ''}> ${({ depth: 'depth (m)', speed: 'speed (m/s)', amps: 'current (A)', heading: 'heading (°)' })[k]}</label>`).join('')}</div>
      <canvas id="chart" width="800" height="340" aria-label="Graph of recorded values"></canvas><div class="legend" id="legend"></div>
      <div class="row"><button class="btn small" data-act="recToggle">${recording ? 'Pause recording' : 'Resume recording'}</button><button class="btn small" data-act="recClear">Clear</button><button class="btn small" data-act="recCsv">Download CSV</button><button class="btn small go" data-act="logRun">Save this run to the design log</button></div></div>`;
  }

  const SERIES_COL = { depth: '#1b7fd1', speed: '#2a8a3a', amps: '#d6332e', heading: '#a36a00' };
  function drawChart() {
    const cv = $('#chart'); if (!cv) return;
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const cs = getComputedStyle(document.documentElement);
    g.clearRect(0, 0, W, H);
    const pad = { l: 46, r: 12, t: 12, b: 30 };
    const data = samples.slice(-600);
    g.strokeStyle = cs.getPropertyValue('--line'); g.lineWidth = 1;
    g.fillStyle = cs.getPropertyValue('--muted'); g.font = '20px JetBrains Mono, monospace';
    for (let i = 0; i <= 4; i++) { const y = pad.t + (H - pad.t - pad.b) * i / 4; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); }
    const leg = [];
    if (data.length < 2) { g.fillText('Drive to record data', pad.l + 10, H / 2); $('#legend').innerHTML = ''; return; }
    const t0 = data[0].t, t1 = data[data.length - 1].t;
    g.textAlign = 'center';
    g.fillText(t0.toFixed(0) + ' s', pad.l, H - 6); g.fillText(t1.toFixed(0) + ' s', W - pad.r - 20, H - 6);
    Object.keys(recSeries).filter(k => recSeries[k]).forEach(k => {
      const vals = data.map(d => d[k]);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (k === 'heading') { lo = 0; hi = 360; } else { lo = Math.min(0, lo); hi = Math.max(hi, lo + (k === 'amps' ? 5 : 0.5)); }
      g.strokeStyle = SERIES_COL[k]; g.lineWidth = 3; g.beginPath();
      data.forEach((d, i) => {
        const x = pad.l + (d.t - t0) / Math.max(0.1, t1 - t0) * (W - pad.l - pad.r);
        const y = pad.t + (1 - (d[k] - lo) / (hi - lo)) * (H - pad.t - pad.b);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
      const lastV = vals[vals.length - 1];
      leg.push(`<span><i style="background:${SERIES_COL[k]}"></i>${({ depth: 'depth', speed: 'speed', amps: 'current', heading: 'heading' })[k]} <b>${lastV}</b> (max ${Math.max(...vals)}, axis ${lo.toFixed(1)}–${hi.toFixed(1)})</span>`);
    });
    $('#legend').innerHTML = leg.join('');
  }
  function dataCsv() {
    if (!samples.length) { toast('No data recorded yet.'); return; }
    const lines = ['time_s,depth_m,speed_m_per_s,current_A,heading_deg,motor_volts'].concat(samples.map(s => [s.t, s.depth, s.speed, s.amps, s.heading, s.volts].join(',')));
    saveFile(slug($('#rovName').value) + '-' + M.def.id + '-data.csv', lines.join('\n'));
  }

  function updatePilotLive(force) {
    if (!M || mode !== 'pilot') return;
    const r = M.rov, T = Physics.telemetry(r);
    // clock overlay
    const co = $('#clockOv');
    if (heat && heat.running) {
      co.hidden = false;
      const left = heat.limit - heat.t;
      co.classList.toggle('warn', left < 60);
      co.innerHTML = `${mmss(heat.t)}<small>Heat ${heat.n} · ${mmss(left)} left</small>`;
    } else if (M.def.drill && !M.state.locked && !M.state.missing) {
      co.hidden = false; co.classList.remove('warn');
      co.innerHTML = `${mmss(M.state.t)}<small>${M.state.started ? esc(M.def.progress(M)) : 'clock starts when you move'}</small>`;
    } else if (M.def.id === 'drag' && M.state.phase && M.state.phase !== 'ready') {
      co.hidden = false; co.classList.remove('warn');
      co.innerHTML = M.state.phase === 'countdown' ? `${Math.ceil(M.state.cd)}<small>get ready</small>` : `${(M.state.t || 0).toFixed(2)} s<small>${DRAG_NAME()}</small>`;
    } else co.hidden = true;
    if (pilotTab === 'mission') {
      const clk = $('#clk'); if (clk && heat) clk.textContent = mmss(heat.t);
      const be = $('#btnEnd');
      if (be && heat) { const can = Missions.atStart(M) && heat.t > 5; be.disabled = !can; const n = $('#endNote'); if (n) n.textContent = can ? 'Tell the judge you are done.' : 'Bring the ROV back to the surface at the starting wall to stop the clock.'; }
      const sb = $('#sheetBox'); if (sb) sb.innerHTML = M.def.drill ? drillSheet() : sheetHtml(M.def.score(M));
    } else if (pilotTab === 'controls') {
      r.thrusters.forEach(t => {
        const el = $('#sw-' + t.id); if (!el) return;
        el.classList.toggle('f', t.out > 0.05); el.classList.toggle('r', t.out < -0.05);
        const pb = el.querySelector('.pbar i'); if (pb) { const v = t.out; pb.style.left = (v >= 0 ? 50 : 50 + v * 50) + '%'; pb.style.width = Math.abs(v) * 50 + '%'; }
      });
      const set = (id, txt, hot) => { const m = $(id); if (m) { m.querySelector('b').textContent = txt; m.classList.toggle('hot', !!hot); } };
      set('#mAmp', T.amps.toFixed(1) + ' A', T.amps > r.elec.fuseA * 0.9);
      set('#mVolt', T.volts.toFixed(1) + ' V', T.volts < 10.5);
      set('#mFuse', r.elec.blown ? 'BLOWN' : r.elec.heat > 0.2 ? 'HOT' : 'OK', r.elec.blown || r.elec.heat > 0.2);
      set('#mDepth', (T.depth / 0.3048).toFixed(1) + ' ft');
      set('#mSpeed', T.speed.toFixed(2) + ' m/s');
      const out = r.p.distanceTo(M.env.anchor) / 0.3048;
      set('#mTether', Math.round(out) + ' / ' + Math.round(r.tether.len / 0.3048) + ' ft', r.tetherTight);
    } else if (pilotTab === 'data') drawChart();
    // fuse banner
    if (r.elec.blown && $('#banner').hidden) { const b = $('#banner'); b.className = 'ov banner bad'; b.innerHTML = `<span>Fuse blown: the motors are dead.</span><button class="btn small stop" data-act="fuse">Replace fuse</button>`; b.hidden = false; }
    if (!r.elec.blown && $('#banner').classList.contains('bad')) $('#banner').hidden = true;
    // tank readout
    if (M.def.id === 'tank' && pilotTab === 'mission') {
      const sb = $('#sheetBox');
      if (sb) sb.innerHTML = `<div class="sheet"><h4>Trim test<span>${M.state.hold ? 'held still' : 'released'}</span></h4><table>
        <tr><td>Net lift (calculated)</td><td class="n">${Math.round(r.mp.net) >= 0 ? '+' : ''}${Math.round(r.mp.net)} g</td></tr>
        <tr><td>Vertical speed</td><td class="n">${(T.vy * 100).toFixed(1)} cm/s ${T.vy > 0.01 ? 'rising' : T.vy < -0.01 ? 'sinking' : 'steady'}</td></tr>
        <tr><td>Pitch</td><td class="n">${T.pitch >= 0 ? 'nose up ' : 'nose down '}${Math.abs(T.pitch).toFixed(1)}°</td></tr>
        <tr><td>Roll</td><td class="n">${Math.abs(T.roll).toFixed(1)}° ${T.roll > 0.5 ? 'right' : T.roll < -0.5 ? 'left' : ''}</td></tr>
        <tr><td>Depth</td><td class="n">${(T.depth * 100).toFixed(0)} cm</td></tr></table></div>`;
    }
  }
  const DRAG_NAME = () => (Missions.DRAG_ROUNDS[Math.min(M.state.round || 0, 2)] || {}).name || '';

  /* ---------------- pilot training drills ---------------- */
  const DRILL_IDS = Object.keys(Missions.DRILLS);
  function drillUnlocked(n) { return n === 1 || ((progress.drills || {})['drill' + (n - 1)] || {}).stars >= 1; }
  function drillMissing(def) {
    const r = Physics.create(design);
    if (def.needs === 'camera' && !r.cameras.length) return 'This drill needs a camera. Add one in Build, step 3.';
    if (def.needs === 'grab' && !r.tools.some(t => t.type === 'prong' || t.type === 'claw')) return 'This drill needs a prong or a claw. Add one in Build, step 4.';
    if (def.needs === 'tool' && !r.tools.some(t => t.type !== 'ruler')) return 'This drill needs a tool such as the spool fork, a prong or a claw. Add one in Build, step 4.';
    return null;
  }
  const starStr = n => '★'.repeat(n) + '☆'.repeat(3 - n);
  function finishDrill() {
    const def = M.def, s = M.state;
    s.recorded = true;
    const t = s.t, stars = t <= def.stars[0] ? 3 : t <= def.stars[1] ? 2 : 1;
    const D = progress.drills = progress.drills || {};
    const old = D[def.id] || {};
    D[def.id] = { stars: Math.max(old.stars || 0, stars), best: Math.min(old.best || 9999, +t.toFixed(1)), runs: (old.runs || 0) + 1 };
    saveProgress();
    logTest(def.title, `${starStr(stars)} in ${mmss(t)}`);
    beep('flag');
    const next = MISSIONS['drill' + (def.drill + 1)];
    modal(`${def.short} complete!`, `<p class="stars-big" aria-label="${stars} of 3 stars">${starStr(stars)}</p>
      <p>Time: <b>${mmss(t)}</b>${old.best && old.best < 9999 ? ` · your best: ${mmss(Math.min(old.best, t))}` : ''}</p>
      <p class="note">3 stars: under ${mmss(def.stars[0])} · 2 stars: under ${mmss(def.stars[1])} · 1 star: finish.</p>
      ${next ? `<p>Next up: <b>${esc(next.title)}</b>.</p>` : '<p><b>You finished pilot training.</b> You are ready for the challenges. Try the practice pool, then run a heat.</p>'}`,
      [{ label: 'Try again', run: () => loadMission(def.id) }, { label: next ? 'Next drill' : 'Go to the practice pool', cls: 'go', run: () => loadMission(next ? next.id : 'practice') }]);
    renderPilot();
  }
  function drillSheet() {
    const def = M.def, s = M.state, best = (progress.drills || {})[def.id];
    if (s.locked) return `<div class="card"><b>Locked</b><p class="note">Finish ${esc(MISSIONS['drill' + (def.drill - 1)].title)} first.</p></div>`;
    if (s.missing) return `<div class="card"><b>Can’t start yet</b><p class="note">${esc(s.missing)}</p><button class="btn small" data-act="goBuild">Go to Build</button></div>`;
    return `<div class="sheet"><h4>${esc(def.title)}<span>${mmss(s.t)}</span></h4><table>
      <tr><td>Goal</td><td class="n">${esc(def.progress(M))}</td></tr>
      <tr><td>Stars</td><td class="n">★★★ under ${mmss(def.stars[0])} · ★★ under ${mmss(def.stars[1])}</td></tr>
      <tr><td>Your best</td><td class="n">${best ? starStr(best.stars) + ' ' + mmss(best.best) : '—'}</td></tr></table></div>`;
  }
  function drillListHtml() {
    const D = progress.drills || {};
    const total = DRILL_IDS.reduce((a, id) => a + ((D[id] || {}).stars || 0), 0);
    return `<div class="sec"><span class="sec-label">Pilot training · ${total} of ${DRILL_IDS.length * 3} stars</span><div class="drills">${DRILL_IDS.map(id => {
      const d = MISSIONS[id], got = (D[id] || {}).stars || 0, open = drillUnlocked(d.drill);
      return `<button class="dcard" data-mission="${id}" aria-pressed="${M.def.id === id}" ${open ? '' : 'disabled'} title="${esc(d.title)}"><b>${d.drill}</b><span>${esc(d.short)}</span><em>${open ? starStr(got) : 'locked'}</em></button>`;
    }).join('')}</div></div>`;
  }

  /* ---------------- heat replay ---------------- */
  function saveReplay(id, h, total, elapsed) {
    if (!h || !h.track) return;
    const R = store.get('replays', {});
    R[id + '-' + h.n] = { mission: id, n: h.n, pool: M.def.pool, start: M.def.start, items: h.items, track: h.track, events: h.events, total, elapsed, at: new Date().toISOString(), title: M.def.title };
    store.set('replays', R);
  }
  let replayTimer = null;
  function openReplay(id, n) {
    const rec = store.get('replays', {})[id + '-' + n];
    if (!rec || !rec.track || rec.track.length < 2) { toast('No replay saved for that heat.'); return; }
    const pool = Missions.POOLS[rec.pool];
    const st = Extras.replayStats(rec);
    const dur = st.dur;
    modal(`Replay: ${rec.title.split(': ')[1] || rec.title}, heat ${rec.n}`, `
      <div class="replay">
        <canvas id="rpMap" width="440" height="560" aria-label="Top view of the ROV's path"></canvas>
        <div class="rp-side">
          <div class="row"><button class="btn small go" id="rpPlay">▶ Play</button><select class="inp" id="rpSpeed"><option value="4">4×</option><option value="10" selected>10×</option><option value="30">30×</option></select><span class="clock" id="rpClock">00:00</span></div>
          <input type="range" id="rpScrub" min="0" max="${dur.toFixed(1)}" step="0.5" value="${dur.toFixed(1)}" aria-label="Replay time">
          <canvas id="rpDepth" width="440" height="70" aria-label="Depth over time"></canvas>
          <span class="note">Depth over time (top = surface). Ticks mark events.</span>
          <dl class="kv"><dt>Score</dt><dd>${rec.total ?? '—'}</dd><dt>Elapsed</dt><dd>${mmss(dur)}</dd><dt>Distance driven</dt><dd>${st.dist.toFixed(1)} m</dd><dt>Average speed</dt><dd>${st.avg.toFixed(2)} m/s</dd>
            <dt>Time under water</dt><dd>${Math.round(st.under / Math.max(1, dur) * 100)}%</dd><dt>First points at</dt><dd>${st.firstScore != null ? mmss(st.firstScore) : '—'}</dd><dt>Longest time with no points</dt><dd>${mmss(st.longestGap)}</dd></dl>
          <ol class="rp-events">${rec.events.map((e, i) => `<li data-t="${e.t}" class="${e.cls}"><b>${i + 1}</b> <span>${mmss(e.t)}</span> ${esc(e.msg)}</li>`).join('') || '<li>No events.</li>'}</ol>
        </div></div>
      <p class="note">Blue path = early in the heat, orange = late. Thick line = under water, thin = at the surface. Ask: where did we lose time? What would we do differently next heat?</p>`,
      [{ label: 'Close', run: () => { clearInterval(replayTimer); } }], true);
    const map = $('#rpMap'), depth = $('#rpDepth'), scrub = $('#rpScrub'), clock = $('#rpClock'), play = $('#rpPlay');
    const draw = () => { const t = +scrub.value; Extras.drawReplay(map, rec, pool, t); Extras.drawDepthStrip(depth, rec, t); clock.textContent = mmss(t); };
    scrub.addEventListener('input', draw);
    $('#mBody').querySelectorAll('.rp-events li[data-t]').forEach(li => li.addEventListener('click', () => { scrub.value = li.dataset.t; draw(); }));
    play.addEventListener('click', () => {
      if (replayTimer) { clearInterval(replayTimer); replayTimer = null; play.textContent = '▶ Play'; return; }
      if (+scrub.value >= dur) scrub.value = 0;
      play.textContent = '❚❚ Pause';
      replayTimer = setInterval(() => {
        const v = Math.min(dur, +scrub.value + 0.1 * +$('#rpSpeed').value);
        scrub.value = v; draw();
        if (v >= dur) { clearInterval(replayTimer); replayTimer = null; play.textContent = '▶ Play'; }
      }, 100);
    });
    draw();
  }

  /* ---------------- design log (engineering journal) ---------------- */
  let journal = store.get('journal', { versions: [] });
  function saveJournal() { store.set('journal', journal); }
  function currentVersion(create) {
    const h = Extras.designHash(design);
    let v = journal.versions.find(x => x.hash === h);
    if (!v && create) {
      const prev = journal.versions[journal.versions.length - 1];
      v = { v: journal.versions.length + 1, at: new Date().toISOString(), hash: h, design: Design.clone(design), stats: Extras.designStats(design), changes: Extras.changeSummary(prev && prev.design, design), tests: [], note: '' };
      journal.versions.push(v);
      if (journal.versions.length > 40) journal.versions.shift();
    }
    return v;
  }
  function logTest(label, result) {
    const fresh = !journal.versions.find(x => x.hash === Extras.designHash(design));
    const v = currentVersion(true);
    v.tests.push({ at: new Date().toISOString(), label, result, topSpeed: M && M.maxSpeed ? +M.maxSpeed.toFixed(2) : null });
    saveJournal();
    if (fresh) setTimeout(() => toast(`Saved to your design log as version ${v.v}.`), 1200);
  }
  function logRun() {
    if (!M) return;
    const maxD = samples.length ? Math.max(...samples.map(s => s.depth)) : 0;
    const maxA = samples.length ? Math.max(...samples.map(s => s.amps)) : 0;
    logTest(`${M.def.short} run`, `top speed ${(M.maxSpeed || 0).toFixed(2)} m/s, deepest ${(maxD / 0.3048).toFixed(1)} ft, peak current ${maxA.toFixed(1)} A`);
    toast('Saved this run to your design log.');
  }

  function openJournal() { $('#journal').hidden = false; renderJournal(); }
  let jCompare = [];
  function renderJournal() {
    const vs = journal.versions.slice().reverse();
    const cmp = jCompare.map(n => journal.versions.find(v => v.v === n)).filter(Boolean);
    let cmpHtml = '';
    if (cmp.length === 2) {
      const [a, b] = cmp.sort((x, y) => x.v - y.v);
      const best = v => v.tests.length ? v.tests.map(t => `${t.label}: ${t.result}`).join('<br>') : '—';
      const row = (label, fa, fb, unit, better) => {
        const d = typeof fa === 'number' && typeof fb === 'number' ? fb - fa : null;
        const cls = d == null || !d || !better ? '' : (better === 'low' ? d < 0 : d > 0) ? 'up' : 'down';
        const f = v => v == null ? '—' : unit === '$' ? fmt$(v) : v + unit;
        const fd = unit === '$' ? (d > 0 ? '+' : '−') + fmt$(Math.abs(d)) : (d > 0 ? '+' : '') + (Math.round(d * 100) / 100) + unit;
        return `<tr><td>${label}</td><td class="n">${f(fa)}</td><td class="n">${f(fb)}</td><td class="n ${cls}">${d ? fd : ''}</td></tr>`;
      };
      const ts = v => Math.max(0, ...v.tests.map(t => t.topSpeed || 0)) || null;
      cmpHtml = `<div class="card"><div class="row between"><b>Comparing v${a.v} and v${b.v}</b><button class="btn small" data-j="clearcmp">Clear</button></div>
        <p class="note">What changed: ${b.changes.map(esc).join(' · ')}</p>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th class="n">v${a.v}</th><th class="n">v${b.v}</th><th class="n">Change</th></tr></thead><tbody>
        ${row('Cost', a.stats.cost, b.stats.cost, '$', 'low')}${row('Buoyancy', a.stats.net, b.stats.net, ' g')}${row('Mass', a.stats.mass, b.stats.mass, ' g', 'low')}${row('Motors', a.stats.motors, b.stats.motors, '')}${row('Full-power current', a.stats.amps, b.stats.amps, ' A', 'low')}${row('Top speed seen', ts(a), ts(b), ' m/s', 'high')}
        <tr><td>Tests</td><td>${best(a)}</td><td>${best(b)}</td><td></td></tr></tbody></table></div></div>`;
    } else if (journal.versions.length > 1) cmpHtml = `<p class="note">Tick <b>Compare</b> on two versions to see them side by side.</p>`;
    $('#jBody').innerHTML = (vs.length ? '' : `<div class="card"><b>No versions yet</b><p class="note">Every time you test your ROV (a drill, a heat, a drag race, or “Save this run” on the Data tab), the simulator saves a snapshot of the design and the result here. Change one thing at a time, test again, and you have a design spiral for your engineering journal.</p></div>`) + cmpHtml +
      vs.map(v => `<article class="jcard">
        <div class="row between"><h3>Version ${v.v} <small>${new Date(v.at).toLocaleString()}</small></h3>
          <span class="row"><label class="chk"><input type="checkbox" data-jcmp="${v.v}" ${jCompare.includes(v.v) ? 'checked' : ''}> Compare</label><button class="btn small" data-jload="${v.v}">Load this design</button></span></div>
        <div class="chipsrow">${v.changes.map(c => `<span class="pill">${esc(c)}</span>`).join('')}</div>
        <dl class="kv jstats"><dt>Cost</dt><dd>${fmt$(v.stats.cost)}</dd><dt>Buoyancy</dt><dd>${v.stats.net >= 0 ? '+' : ''}${v.stats.net} g</dd><dt>Motors</dt><dd>${v.stats.motors} (${v.stats.amps} A)</dd><dt>Size</dt><dd>${v.stats.size.join(' × ')} in</dd><dt>Tools</dt><dd>${esc(v.stats.tools.join(', ') || 'none')}</dd></dl>
        ${v.tests.length ? `<ul class="results">${v.tests.map(t => `<li><span>${esc(t.label)}${t.topSpeed ? ` <small class="note">· top speed ${t.topSpeed.toFixed(2)} m/s</small>` : ''}</span><b>${esc(t.result)}</b></li>`).join('')}</ul>` : '<p class="note">No tests on this version.</p>'}
        <label class="note">What we changed, why, and what we learned<textarea class="inp jnote" data-jnote="${v.v}" rows="3" placeholder="Example: We moved the motors back 3 inches because the ROV tipped nose-up when driving. It now drives level and is 0.05 m/s faster.">${esc(v.note)}</textarea></label>
      </article>`).join('');
  }
  $('#journal').addEventListener('click', e => {
    const t = e.target;
    if (t.id === 'jClose') { $('#journal').hidden = true; return; }
    if (t.id === 'jExport') { if (!journal.versions.length) return toast('Test your ROV first to start the log.'); return saveFile(slug($('#rovName').value) + '-design-log.html', Extras.journalHtml(journal, $('#teamName').value.trim(), $('#rovName').value)); }
    if (t.dataset.j === 'clearcmp') { jCompare = []; return renderJournal(); }
    if (t.dataset.jload) {
      const v = journal.versions.find(x => x.v === +t.dataset.jload);
      modal(`Load version ${v.v}?`, '<p>This replaces the ROV you are building now with this saved version. You can undo with ↶ in Build.</p>', [{ label: 'Cancel' }, { label: 'Load it', cls: 'go', run: () => { commit(); design = Design.validate(v.design) || design; $('#rovName').value = design.name; sel = null; changed(); fitBuilder(); $('#journal').hidden = true; setMode('build'); toast(`Loaded version ${v.v}.`); } }]);
    }
  });
  $('#journal').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.jcmp) { const n = +t.dataset.jcmp; jCompare = t.checked ? jCompare.concat(n).slice(-2) : jCompare.filter(x => x !== n); renderJournal(); }
  });
  $('#journal').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.jnote) { const v = journal.versions.find(x => x.v === +t.dataset.jnote); if (v) { v.note = t.value.slice(0, 2000); saveJournal(); } }
  });
  $('#btnJournal').onclick = openJournal;

  // Shop sheet shown inside the app; Print works on a normal web page, Save works everywhere
  function openShopSheet() {
    const html = Extras.shopSheet(design, $('#teamName').value.trim(), $('#rovName').value, { embed: true });
    const inClaude = !!(window.claude && window.claude.use);
    $('#ssPrint').hidden = inClaude;
    $('#ssNote').textContent = inClaude ? 'To print, save a copy, then open the file and print it from your browser.' : '';
    $('#ssFrame').srcdoc = html;
    $('#sheetView').hidden = false;
  }
  $('#ssClose').onclick = () => { $('#sheetView').hidden = true; };
  $('#ssPrint').onclick = () => { try { $('#ssFrame').contentWindow.print(); } catch (e) { toast('Printing is not available here. Save a copy and print that.'); } };
  $('#ssSave').onclick = () => saveFile(slug($('#rovName').value) + '-shop-sheet.html', Extras.shopSheet(design, $('#teamName').value.trim(), $('#rovName').value));

  function setJunior(on) {
    opts.junior = on; store.set('opts', opts);
    if (on) {
      commit();
      design.elec = Object.assign({}, U.DEFAULT_ELECTRICAL);
      design.sealed = false;
      store.set('design', design);
      if (buildStep === 'power') buildStep = 'check';
    }
    pilotDirty = true;
    rebuildBuilder(); renderSide();
    toast(on ? 'Junior mode on: simpler steps, standard wiring, and the fuse can’t blow.' : 'Junior mode off: every step and rule is back.');
  }

  /* ---------------- mode switching ---------------- */
  function setMode(m) {
    mode = m;
    $('#modeBuild').setAttribute('aria-pressed', m === 'build');
    $('#modePilot').setAttribute('aria-pressed', m === 'pilot');
    $('#hint').hidden = m !== 'build'; $('#btip').hidden = true; $('#pipLabel').hidden = true;
    if (m !== 'build' && placing) placing = null;
    $('#hud').hidden = m === 'build'; $('#monitor').hidden = true; $('#map').hidden = true; $('#clockOv').hidden = true; $('#banner').hidden = true;
    $('#touch').hidden = !(m === 'pilot' && opts.touch);
    if (m === 'pilot') {
      if (!M || pilotDirty) {
        if (heat && heat.running) toast('You changed the ROV, so the heat was stopped.');
        loadMission(M ? M.def.id : 'practice');
      }
    } else {
      if (heat && heat.running) toast('Heat paused while you are in Build. Changing the ROV ends the heat.');
      rebuildBuilder();
    }
    renderSide(); renderViewButtons();
  }
  $('#modeBuild').onclick = () => setMode('build');
  $('#modePilot').onclick = () => {
    const ins = Design.inspect(design);
    if (!design.parts.some(p => PARTS[p.type].kind === 'thruster')) { toast('Add at least one thruster first.'); return; }
    setMode('pilot');
    if (!ins.ok) pushEvent('This ROV would not pass inspection yet. You can still test it.', 'bad');
  };

  /* ---------------- menu ---------------- */
  function renderMenu() {
    $('#menuPop').innerHTML = `
      <div class="menu-label">ROV design</div>
      <button data-m="open">Open a design file…</button>
      <button data-m="save">Save design file</button>
      <button data-m="budget">Download budget (CSV)</button>
      <button data-m="shop">Shop sheet…</button>
      <button data-m="log">Design log…</button>
      <div class="menu-sep"></div><div class="menu-label">Options</div>
      <label class="chk"><input type="checkbox" data-o="sound" ${opts.sound ? 'checked' : ''}> Sound</label>
      <label class="chk"><input type="checkbox" data-o="murky" ${opts.murky ? 'checked' : ''}> Murky water (harder to see)</label>
      <label class="chk"><input type="checkbox" data-o="touch" ${opts.touch ? 'checked' : ''}> On-screen touch controls</label>
      <label class="chk"><input type="checkbox" data-o="balance" ${opts.balance ? 'checked' : ''}> Show center of mass and buoyancy</label>
      <label class="chk"><input type="checkbox" id="optJunior" ${opts.junior ? 'checked' : ''}> Junior mode (grades 3–6)</label>
      <label class="chk"><input type="checkbox" id="optDark" ${isDark() ? 'checked' : ''}> Dark theme</label>
      <div class="menu-sep"></div><div class="menu-label">Teacher</div>
      <button data-m="teacher">Check student work…</button>
      <div class="menu-sep"></div>
      <button data-m="welcome">How this lab works</button>
      <button data-m="clear">Clear my scores…</button>`;
  }
  $('#btnMenu').onclick = e => {
    e.stopPropagation();
    const p = $('#menuPop'); const open = p.hidden;
    if (open) renderMenu();
    p.hidden = !open; $('#btnMenu').setAttribute('aria-expanded', open);
  };
  document.addEventListener('click', e => { if (!e.target.closest('.popwrap')) { $('#menuPop').hidden = true; $('#btnMenu').setAttribute('aria-expanded', 'false'); } });
  $('#menuPop').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.o) { opts[t.dataset.o] = t.checked; store.set('opts', opts); if (t.dataset.o === 'balance') rebuildBuilder(); if (t.dataset.o === 'touch') $('#touch').hidden = !(mode === 'pilot' && opts.touch); }
    if (t.id === 'optJunior') { $('#menuPop').hidden = true; setJunior(t.checked); return; }
    if (t.id === 'optDark') { document.documentElement.dataset.theme = t.checked ? 'dark' : 'light'; store.set('theme', document.documentElement.dataset.theme); buildGrid(); }
  });
  $('#menuPop').addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    $('#menuPop').hidden = true;
    const m = b.dataset.m;
    if (m === 'open') $('#openFile').click();
    if (m === 'save') saveFile(slug($('#rovName').value) + '.rov.json', JSON.stringify(Object.assign({ app: 'uivd-rov-lab' }, design), null, 1));
    if (m === 'budget') budgetCsv();
    if (m === 'shop') act('shopSheet');
    if (m === 'log') openJournal();
    if (m === 'teacher') openTeacher();
    if (m === 'welcome') welcome();
    if (m === 'clear') modal('Clear all your heat scores?', '<p>Your ROV design stays. Only challenge scores are cleared.</p>', [{ label: 'Cancel' }, { label: 'Clear scores', cls: 'stop', run: () => { progress = {}; saveProgress(); renderSide(); } }]);
  });
  $('#openFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      const d = Design.validate(obj.design || obj);
      if (!d) throw new Error('bad');
      commit(); design = d; $('#rovName').value = d.name; sel = null; changed(); fitBuilder(); setMode('build'); toast('Opened ' + d.name);
    } catch (err) { toast('That file is not an ROV design.'); }
  });

  /* ---------------- turn in ---------------- */
  $('#btnTurnIn').onclick = () => {
    const ins = Design.inspect(design), mp = Design.massProps(design);
    const P = progress;
    const bestOf = id => P[id] && P[id].heats ? Math.max(...P[id].heats.filter(Boolean).map(h => h.total)) : null;
    const team = $('#teamName').value.trim();
    modal('Turn in your work', `
      <p>This saves one file with your ROV design, budget, inspection and challenge scores. Give it to your teacher.</p>
      <div class="tbl-wrap"><table class="tbl"><tbody>
        <tr><td>Team</td><td>${team ? esc(team) : '<span style="color:var(--warn)">Type your team number and names at the top first</span>'}</td></tr>
        <tr><td>ROV</td><td>${esc($('#rovName').value)}</td></tr>
        <tr><td>Budget</td><td>${fmt$(ins.budget.total)}</td></tr>
        <tr><td>Inspection</td><td>${ins.ok ? 'Pass' : ins.items.filter(i => !i.pass && i.kind !== 'warn').map(i => i.id).join(', ') + ' to fix'}</td></tr>
        <tr><td>Buoyancy</td><td>${Math.round(mp.net)} g net</td></tr>
        <tr><td>#1 Hoop</td><td>${P.hoop && P.hoop.score != null ? P.hoop.score + ' / 100' : 'not done'}</td></tr>
        <tr><td>#2 Flag (best raw)</td><td>${bestOf('flag') ?? 'not done'}</td></tr>
        <tr><td>#3 Carp (best raw)</td><td>${bestOf('carp') ?? 'not done'}</td></tr>
        <tr><td>Pilot training</td><td>${Object.values(P.drills || {}).reduce((a, d) => a + (d.stars || 0), 0)} of 18 stars</td></tr>
        <tr><td>Design log</td><td>${journal.versions.length} versions, ${journal.versions.reduce((a, v) => a + v.tests.length, 0)} tests</td></tr>
        <tr><td>#4 Drag race</td><td>${P.drag && P.drag.bestTime < 900 ? P.drag.bestTime.toFixed(2) + ' s, ' + (P.drag.rounds || 0) + ' rounds won' : 'not done'}</td></tr>
      </tbody></table></div>`, [{ label: 'Cancel' }, {
        label: 'Save turn-in file', cls: 'go', run: () => {
          const out = { app: 'uivd-rov-lab', kind: 'turn-in', v: 1, team, rov: $('#rovName').value, at: new Date().toISOString(), design, budget: { total: ins.budget.total, byLine: ins.budget.byLine }, inspection: { ok: ins.ok, fails: ins.items.filter(i => !i.pass && i.kind !== 'warn').map(i => i.id) }, trim: { net: Math.round(mp.net), pitch: mp.pitch, roll: mp.roll, mass: Math.round(mp.M) }, progress, junior: !!opts.junior,
            journal: journal.versions.map(v => ({ v: v.v, at: v.at, changes: v.changes, stats: v.stats, tests: v.tests, note: v.note })) };
          saveFile(slug(team || 'team') + '-' + slug($('#rovName').value) + '-turn-in.json', JSON.stringify(out, null, 1));
        }
      }]);
  };

  /* ---------------- teacher view ---------------- */
  let tFiles = [];
  function openTeacher() { $('#teacher').hidden = false; renderTeacher(); }
  $('#tClose').onclick = () => { $('#teacher').hidden = true; };
  $('#tClear').onclick = () => { tFiles = []; renderTeacher(); };
  $('#tFiles').addEventListener('change', e => { addTeacherFiles(e.target.files); e.target.value = ''; });
  $('#teacher').addEventListener('dragover', e => { e.preventDefault(); $('#teacher').classList.add('drop'); });
  $('#teacher').addEventListener('dragleave', () => $('#teacher').classList.remove('drop'));
  $('#teacher').addEventListener('drop', e => { e.preventDefault(); $('#teacher').classList.remove('drop'); addTeacherFiles(e.dataTransfer.files); });
  async function addTeacherFiles(list) {
    for (const f of list) {
      try {
        const o = JSON.parse(await f.text());
        if (o.app !== 'uivd-rov-lab' || o.kind !== 'turn-in') throw new Error('not');
        tFiles.push({ name: f.name, o });
      } catch (e) { toast(f.name + ' is not a turn-in file'); }
    }
    renderTeacher();
  }
  function teacherRows() {
    const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
    const rows = tFiles.map(({ name, o }) => {
      const P = o.progress || {};
      const heats = id => (P[id] && Array.isArray(P[id].heats) ? P[id].heats.filter(h => h && typeof h === 'object') : []);
      const best = id => { const h = heats(id).map(x => num(x.total)).filter(x => x != null); return h.length ? Math.max(...h) : null; };
      const fastest = id => { const h = heats(id).filter(x => x.complete && num(x.elapsed) != null).sort((a, b) => a.elapsed - b.elapsed)[0]; return h || null; };
      return {
        name, team: String(o.team || '').slice(0, 80), rov: String(o.rov || '').slice(0, 60), at: o.at,
        budget: num(o.budget && o.budget.total), insp: o.inspection && o.inspection.ok, fails: (o.inspection && Array.isArray(o.inspection.fails) ? o.inspection.fails : []).slice(0, 12).map(String),
        hoop: P.hoop && num(P.hoop.score), hoopAns: P.hoop && num(P.hoop.answer), hoopKnown: P.hoop && num(P.hoop.known),
        flag: best('flag'), flagFast: fastest('flag'), carp: best('carp'), carpFast: fastest('carp'),
        drag: P.drag && num(P.drag.bestTime) < 900 ? num(P.drag.bestTime) : null, dragRounds: P.drag ? num(P.drag.rounds) || 0 : 0,
        stars: P.drills && typeof P.drills === 'object' ? Object.values(P.drills).reduce((a, d) => a + (num(d && d.stars) || 0), 0) : 0,
        logV: Array.isArray(o.journal) ? o.journal.length : 0, logT: Array.isArray(o.journal) ? o.journal.reduce((a, v) => a + (Array.isArray(v && v.tests) ? v.tests.length : 0), 0) : 0, junior: !!o.junior
      };
    });
    // time bonus: 25 / 15 / 5 for the three fastest complete heats under 15 minutes
    ['flag', 'carp'].forEach(id => {
      const ranked = rows.filter(r => r[id + 'Fast'] && r[id + 'Fast'].elapsed < 900).sort((a, b) => a[id + 'Fast'].elapsed - b[id + 'Fast'].elapsed);
      rows.forEach(r => r[id + 'Bonus'] = 0);
      ranked.slice(0, 3).forEach((r, i) => { r[id + 'Bonus'] = [25, 15, 5][i]; });
      rows.forEach(r => {
        const withBonus = r[id + 'Fast'] ? num(r[id + 'Fast'].total) + r[id + 'Bonus'] : null;
        r[id + 'Raw'] = r[id] == null ? null : Math.max(r[id], withBonus || -Infinity);
      });
      const mx = Math.max(0, ...rows.map(r => r[id + 'Raw'] || 0));
      rows.forEach(r => { r[id + 'Norm'] = r[id + 'Raw'] == null || mx <= 0 ? null : Math.round(Math.max(0, r[id + 'Raw']) / mx * 1000) / 10; });
    });
    rows.forEach(r => { r.overall = Math.round(((r.hoop || 0) + (r.flagNorm || 0) + (r.carpNorm || 0)) * 10) / 10; });
    return rows.sort((a, b) => b.overall - a.overall);
  }
  function renderTeacher() {
    const rows = teacherRows();
    const dupes = {};
    tFiles.forEach(f => { const k = JSON.stringify(f.o.design && f.o.design.pipes); dupes[k] = (dupes[k] || 0) + 1; });
    $('#tBody').innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Rank</th><th>Team</th><th>ROV</th><th class="n">Budget</th><th>Inspection</th><th class="n">#1 Hoop</th><th class="n">#2 raw</th><th class="n">#2 bonus</th><th class="n">#2 norm.</th><th class="n">#3 raw</th><th class="n">#3 bonus</th><th class="n">#3 norm.</th><th class="n">Overall / 300</th><th class="n">Drag race</th><th class="n">Training</th><th class="n">Design log</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr><td class="n">${i + 1}</td><td>${esc(r.team || '(no name)')}${r.junior ? ' <span class="pill">Junior</span>' : ''}<br><span class="note">${esc(r.name)}</span></td><td>${esc(r.rov)}</td><td class="n">${r.budget != null ? fmt$(r.budget) : '—'}${r.budget > 2000 ? ' <span class="pill fail">over</span>' : ''}</td>
        <td>${r.insp ? '<span class="pill pass">Pass</span>' : `<span class="pill fail">Fix ${esc(r.fails.join(', '))}</span>`}</td>
        <td class="n">${r.hoop != null ? r.hoop.toFixed(1) : '—'}${r.hoopAns != null ? `<br><span class="note">${r.hoopAns.toFixed(2)} vs ${r.hoopKnown != null ? r.hoopKnown.toFixed(3) : '?'} m²</span>` : ''}</td>
        <td class="n">${r.flag ?? '—'}${r.flagFast ? `<br><span class="note">${mmss(r.flagFast.elapsed)}</span>` : ''}</td><td class="n">${r.flagBonus || ''}</td><td class="n">${r.flagNorm ?? '—'}</td>
        <td class="n">${r.carp ?? '—'}${r.carpFast ? `<br><span class="note">${mmss(r.carpFast.elapsed)}</span>` : ''}</td><td class="n">${r.carpBonus || ''}</td><td class="n">${r.carpNorm ?? '—'}</td>
        <td class="n"><b>${r.overall.toFixed(1)}</b></td><td class="n">${r.drag != null ? r.drag.toFixed(2) + ' s' : '—'}<br><span class="note">${r.dragRounds} won</span></td><td class="n">${r.stars} / 18 ★</td><td class="n">${r.logV} versions<br><span class="note">${r.logT} tests</span></td></tr>`).join('')}
      </tbody></table></div>${Object.values(dupes).some(n => n > 1) ? '<p class="note" style="color:var(--warn)">Two or more files have exactly the same frame. Check that teams built their own ROVs.</p>' : ''}` : '<p class="note">No files yet.</p>';
  }
  $('#tExport').onclick = () => {
    const rows = teacherRows();
    if (!rows.length) { toast('Add turn-in files first.'); return; }
    const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const head = ['rank', 'team', 'rov', 'budget', 'inspection', 'hoop_score', 'hoop_answer_m2', 'hoop_known_m2', 'flag_best_raw', 'flag_bonus', 'flag_normalized', 'carp_best_raw', 'carp_bonus', 'carp_normalized', 'overall_300', 'drag_best_s', 'drag_rounds_won', 'training_stars', 'log_versions', 'log_tests', 'junior'];
    const lines = [head.join(',')].concat(rows.map((r, i) => [i + 1, r.team, r.rov, r.budget, r.insp ? 'pass' : 'fix ' + r.fails.join(' '), r.hoop, r.hoopAns, r.hoopKnown, r.flag, r.flagBonus, r.flagNorm, r.carp, r.carpBonus, r.carpNorm, r.overall, r.drag, r.dragRounds, r.stars, r.logV, r.logT, r.junior ? 'yes' : 'no'].map(q).join(',')));
    saveFile('uivd-class-results.csv', lines.join('\n'));
  };

  /* ---------------- guide and welcome ---------------- */
  const GUIDE = {
    'Buoyancy and trim': `<p>Water pushes up on your ROV with a force equal to the weight of the water it displaces. Fresh water weighs 1 g per cm³, so:</p>
      <div class="formula">net lift (g) = volume displaced (cm³) − mass (g)</div>
      <p>A <b>500 GPH bilge motor</b> weighs 230 g but displaces 170 cm³, so it sinks with 60 g. A <b>6" pool noodle</b> weighs 12 g and displaces 420 cm³, so it lifts 408 g. ½" PVC that is flooded sinks about 1.9 g per inch; sealed, it floats about 3.3 g per inch.</p>
      <p>Most teams trim slightly positive (about +20 to +60 g) so a dead ROV floats back up. Drag racers must be close to neutral.</p>`,
    'Stability': `<p>Gravity pulls down at the <b>center of mass</b> (red). Buoyancy pushes up at the <b>center of buoyancy</b> (blue). When blue is above red, any tilt makes a twisting force that brings the ROV back level, like a pendulum.</p>
      <p>Put floats high and weights low to make the ROV more stable. If the two centers are not lined up front to back, the ROV sits nose up or nose down; the Balance number tells you by how much.</p>
      <p>Thrusters mounted far above or below the center of mass make the ROV pitch when it drives. Mount your forward thrusters close to the height of the red dot.</p>`,
    'Thrust, current and the fuse': `<p>Each bilge thruster draws current when it runs: about 2.6 A (500 GPH), 3.6 A (750 GPH) or 5.6 A (1100 GPH). They add up:</p>
      <div class="formula">total current = sum of the motors that are running</div>
      <p>The rules limit the fuse to <b>25 A</b> (rule 6.9). Four 1100 GPH motors at once draw 22.4 A. Five would blow the fuse. Motors push only about 60% as hard in reverse.</p>`,
    'Tether voltage drop': `<p>Copper wire has resistance. Current has to go out and back, so the wire length counts twice:</p>
      <div class="formula">R = (ohms per foot) × (tether length × 2)<br>V at motors = 12.6 V − I × R</div>
      <p>14 AWG wire is about 0.0025 Ω per foot. A 40 ft tether carrying 10 A loses about 2 V. Bilge motors push with roughly (V ÷ 12)² of their rated thrust, so that costs about 30% of your thrust. Thicker wire (smaller gauge number) helps; 18 AWG is not allowed for motors (rule 7.6).</p>`,
    'Measuring the hoop': `<p>Measure the inside diameter <b>d</b> with a ruler or meter stick mounted where your camera can read it. Measure more than once, across different directions, and average.</p>
      <div class="formula">r = d ÷ 2 &nbsp;&nbsp; A = π × r²<br>example: d = 52.0 cm = 0.520 m → r = 0.260 m → A = 3.1416 × 0.0676 = 0.21 m²</div>
      <p>Convert centimeters to meters <i>before</i> squaring: 1 m² = 10,000 cm². Sanity check: a hoop the size of a trash can lid is less than a quarter of a square meter.</p>
      <p>Score = 100 × (1 − |answer − known| ÷ known). Being 5% off scores 95.</p>`,
    'Mission strategy': `<p><b>Rings</b>: a prong collects several rings in one trip, but pointing it down lets them slide off. Hang rings by putting the prong tip right on a J hook bowl and pressing H. Rings handed to shore score only 5 and cancel the time bonus.</p>
      <p><b>Flag</b>: push the spool shaft sideways (the spool fork catches it best) until it turns a quarter turn.</p>
      <p><b>Egg sacs</b>: get a prong or claw through the ring, then follow the arm’s shape exactly: up, over, down. Released sacs float to the surface; push them to any pool edge for a teammate to grab.</p>
      <p><b>Pilots</b>: switch at 7:00. Use the spotter map as your deck teammates’ voices.</p>`
  };
  function guide(topic) {
    topic = topic || Object.keys(GUIDE)[0];
    modal('Engineering guide', `<div class="gtabs">${Object.keys(GUIDE).map(k => `<button data-g="${esc(k)}" aria-pressed="${k === topic}">${esc(k)}</button>`).join('')}</div><h3>${esc(topic)}</h3>${GUIDE[topic]}`, [{ label: 'Close' }], true);
    $('#mBody').querySelectorAll('[data-g]').forEach(b => b.onclick = () => guide(b.dataset.g));
  }
  $('#btnGuide').onclick = () => guide();

  function welcome() {
    modal('Welcome to the Underwater IVD ROV Lab', `
      <p>Design, build and test a virtual ROV for the 2026–27 Square One Underwater IVD competition.</p>
      <ol>
        <li><b>Build</b> your ROV step by step: frame, motors, camera, tools, trim${opts.junior ? '' : ', power'} and a final check.</li>
        <li><b>Train</b> as a pilot with six short drills. Earn up to 3 stars on each.</li>
        <li><b>Compete</b> in heats of the Hula Hoop Hustle, the All Clear Flag, Carp Diem and the Drag Race, then watch the replay.</li>
        <li><b>Keep a design log.</b> Every test is saved with your design, so you can compare versions for your engineering journal.</li>
        <li><b>Build the real one</b> with the printable shop sheet, and <b>turn in</b> one file for your teacher.</li>
      </ol>
      <div class="card"><b>Which version fits your team?</b>
        <div class="row"><button class="btn ${opts.junior ? 'go' : ''}" id="wJunior">Grades 3–6: Junior mode</button><button class="btn ${opts.junior ? '' : 'go'}" id="wFull">Grades 7–12: Full mode</button></div>
        <p class="note">Junior mode uses simpler steps and words, skips the wiring step, and the fuse can’t blow. You can switch any time in the Menu.</p></div>
      <p class="note">The physics are simplified. Real motors, pools and batteries vary, so test your real ROV too.</p>`,
      [{ label: 'Start building', cls: 'go', run: () => store.set('welcomed', true) }]);
    $('#wJunior').onclick = () => { if (!opts.junior) setJunior(true); $('#wJunior').classList.add('go'); $('#wFull').classList.remove('go'); };
    $('#wFull').onclick = () => { if (opts.junior) setJunior(false); $('#wFull').classList.add('go'); $('#wJunior').classList.remove('go'); };
  }

  /* ---------------- splitter ---------------- */
  (function () {
    const sp = $('#splitter'), body = $('.body');
    let w = store.get('sideW', 0); if (w) body.style.gridTemplateColumns = `1fr 8px ${w}px`;
    sp.addEventListener('pointerdown', e => {
      sp.setPointerCapture(e.pointerId);
      const move = ev => { const r = body.getBoundingClientRect(); w = Math.max(320, Math.min(r.width - 360, r.right - ev.clientX)); body.style.gridTemplateColumns = `1fr 8px ${w}px`; };
      const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); store.set('sideW', w); };
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
    });
    sp.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { const r = body.getBoundingClientRect(); w = Math.max(320, Math.min(r.width - 360, (w || 420) + (e.key === 'ArrowLeft' ? 20 : -20))); body.style.gridTemplateColumns = `1fr 8px ${w}px`; store.set('sideW', w); } });
  })();

  /* ---------------- start ---------------- */
  const th = store.get('theme', null); if (th) document.documentElement.dataset.theme = th;
  $('#teamName').value = store.get('team', '');
  $('#rovName').value = design.name || 'My ROV';
  $('#teamName').addEventListener('input', e => store.set('team', e.target.value));
  $('#rovName').addEventListener('input', e => { design.name = e.target.value.slice(0, 60); store.set('design', design); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => buildGrid());
  buildGrid(); fitBuilder(); rebuildBuilder(); renderSide(); renderViewButtons();
  requestAnimationFrame(frame);
  if (!store.get('welcomed', false)) welcome();
  // read-only hook for automated checks
  window.__uivdDebug = { M: () => M, heat: () => heat, design: () => design, screen: (x, y, z) => { const v = V3(x * IN, y * IN, z * IN).project(bCam); const r = canvas.getBoundingClientRect(); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; } };
})();
