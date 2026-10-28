/* three.js drawing: ROV models (shared by the builder and the pool), pool scenes and mission apparatus. */
(function () {
  const U = window.UIVD;
  const { IN, PARTS, DIRS, Design } = U;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  const MAT = {};
  function mat(name, color, opts) {
    if (!MAT[name]) MAT[name] = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0.05 }, opts || {}));
    return MAT[name];
  }
  const NOODLE = [0xff4fa3, 0x3fd66b, 0xffd23f, 0x37b5ff, 0xff8a2a];

  // Cylinder from a to b (Vector3s)
  function rod(a, b, r, material, seg) {
    const d = b.clone().sub(a), L = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, seg || 12), material);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
    return m;
  }

  function rulerTexture(lenM) {
    const cm = Math.round(lenM * 100), pxPerCm = 24;
    const c = document.createElement('canvas'); c.width = cm * pxPerCm; c.height = 72;
    const g = c.getContext('2d');
    g.fillStyle = '#f2d43a'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.font = 'bold 30px Arial';
    for (let i = 0; i <= cm * 10; i++) {
      const x = i * pxPerCm / 10;
      const h = i % 100 === 0 ? 40 : i % 50 === 0 ? 30 : i % 10 === 0 ? 22 : 9;
      g.fillRect(x - (i % 10 === 0 ? 1.5 : 0.6), 0, i % 10 === 0 ? 3 : 1.2, h);
      if (i % 100 === 0 && i > 0 && i < cm * 10) g.fillText(String(i / 10), x, 68);
    }
    const t = new THREE.CanvasTexture(c); t.anisotropy = 8;
    return t;
  }

  function orientTo(obj, dirKey) {
    obj.quaternion.setFromUnitVectors(V3(0, 1, 0), V3(...DIRS[dirKey || 'fwd'].v));
  }

  function partMesh(part, idx) {
    const P = PARTS[part.type];
    const g = new THREE.Group();
    const at = V3(...part.at).multiplyScalar(IN);
    if (P.kind === 'thruster') {
      const r = P.size[0] / 2, L = P.size[2];
      const body = new THREE.Group();
      const can = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L * 0.8, 16), mat('pump', 0xe9e6dc));
      body.add(can);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, L * 0.12, 16), mat('pumpcap', 0x2b2b2b));
      cap.position.y = L * 0.34; body.add(cap);
      // prop at the back (opposite the thrust direction)
      const shroud = new THREE.Mesh(new THREE.TorusGeometry(r * 1.25, r * 0.12, 6, 18), mat('shroud', 0x333a40));
      shroud.rotation.x = Math.PI / 2; shroud.position.y = -L * 0.5; body.add(shroud);
      const prop = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(r * 2.1, r * 0.08, r * 0.55), mat('prop', 0xff7a1a));
        blade.rotation.y = i * Math.PI * 2 / 3; blade.rotation.z = 0.35; prop.add(blade);
      }
      prop.position.y = -L * 0.5; body.add(prop);
      g.userData.prop = prop;
      orientTo(body, part.dir); g.add(body);
    } else if (P.kind === 'camera') {
      const cam = new THREE.Group();
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, P.size[2], 16), mat('cam', 0x1d1f22));
      b.rotation.x = Math.PI / 2; cam.add(b);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 16), mat('lens', 0x5fb0ff, { metalness: 0.6, roughness: 0.15, emissive: 0x0a2a55 }));
      lens.rotation.x = Math.PI / 2; lens.position.z = -P.size[2] / 2; cam.add(lens);
      const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.003, 6, 16), mat('led', 0xffffff, { emissive: 0x777777 }));
      ledRing.position.z = -P.size[2] / 2 - 0.002; cam.add(ledRing);
      cam.rotation.x = (part.tilt || 0) * Math.PI / 180;
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), mat('clamp', 0x444444));
      mount.position.y = -0.02; g.add(mount);
      g.add(cam);
    } else if (P.kind === 'float') {
      const isNoodle = part.type.startsWith('noodle');
      const m = new THREE.Mesh(new THREE.CylinderGeometry(P.size[0] / 2, P.size[0] / 2, P.size[2], isNoodle ? 9 : 16),
        isNoodle ? mat('noodle' + (idx % NOODLE.length), NOODLE[idx % NOODLE.length], { roughness: 0.9 }) : mat('pvcw', 0xf3f3ee));
      orientTo(m, part.dir); g.add(m);
    } else if (P.kind === 'weight') {
      const q = part.qty || 1;
      for (let i = 0; i < q; i++) {
        const m = part.type === 'sinker'
          ? new THREE.Mesh(new THREE.BoxGeometry(P.size[0], P.size[1], P.size[2]), mat('lead', 0x3d4a57, { metalness: 0.4 }))
          : new THREE.Mesh(new THREE.CylinderGeometry(P.size[0] / 2, P.size[0] / 2, P.size[1], 16), mat('steel', 0x9aa3ab, { metalness: 0.7, roughness: 0.35 }));
        m.position.y = -0.012 - i * (P.size[1] + 0.002);
        g.add(m);
      }
    } else if (P.kind === 'tool') {
      const t = new THREE.Group();
      if (P.tool === 'prong') {
        t.add(rod(V3(0, 0, 0), V3(0, P.tipLen, 0), 0.0107, mat('pvc', 0xf6f6f0)));
        // upturned finger at the tip
        t.add(rod(V3(0, P.tipLen, 0), V3(0, P.tipLen, 0.045), 0.0107, mat('pvc', 0xf6f6f0)));
        const tipBall = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), mat('pvcfit', 0xdedbd2));
        tipBall.position.y = P.tipLen; t.add(tipBall);
        t.add(stackRings(g));
      } else if (P.tool === 'claw') {
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.05), mat('clawbox', 0x2d3640));
        box.position.y = 0.035; t.add(box);
        const jawL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.03), mat('jaw', 0xc7a43a, { metalness: 0.5 }));
        const jawR = jawL.clone();
        jawL.position.set(-0.03, 0.12, 0); jawR.position.set(0.03, 0.12, 0);
        t.add(jawL, jawR);
        g.userData.jaws = [jawL, jawR];
      } else if (P.tool === 'fork') {
        t.add(rod(V3(0, 0, 0), V3(0, P.tipLen * 0.6, 0), 0.0107, mat('pvc', 0xf6f6f0)));
        t.add(rod(V3(-0.03, P.tipLen * 0.6, 0), V3(0.03, P.tipLen * 0.6, 0), 0.0107, mat('pvc', 0xf6f6f0)));
        t.add(rod(V3(-0.03, P.tipLen * 0.6, 0), V3(-0.03, P.tipLen, 0), 0.0107, mat('pvc', 0xf6f6f0)));
        t.add(rod(V3(0.03, P.tipLen * 0.6, 0), V3(0.03, P.tipLen, 0), 0.0107, mat('pvc', 0xf6f6f0)));
      } else if (P.tool === 'ruler') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(P.len, P.size[1], P.size[2]),
          [mat('rulerEdge', 0xd8bc2c), mat('rulerEdge', 0xd8bc2c), new THREE.MeshStandardMaterial({ map: rulerTexture(P.len), roughness: 0.5 }), mat('rulerEdge', 0xd8bc2c), mat('rulerEdge', 0xd8bc2c), mat('rulerEdge', 0xd8bc2c)]);
        // the marked face is +y; tilt it toward the camera
        m.rotation.x = 0.35;
        g.add(m);
      }
      if (P.tool !== 'ruler') { orientTo(t, part.dir); g.add(t); }
      g.userData.toolGroup = t;
    }
    g.position.copy(at);
    g.userData.partId = part.id;
    return g;
  }

  // Rings riding on a prong are drawn by the mission code; this is a holder group.
  function stackRings(g) { const s = new THREE.Group(); g.userData.ringStack = s; return s; }

  function buildRov(design, opts) {
    opts = opts || {};
    const root = new THREE.Group();
    const frame = new THREE.Group(); root.add(frame);
    const pipeMat = mat('pvc', 0xf6f6f0), fitMat = mat('pvcfit', 0xdedbd2);
    design.pipes.forEach((p, i) => {
      const m = rod(V3(...p.a).multiplyScalar(IN), V3(...p.b).multiplyScalar(IN), U.PIPE.od / 2, pipeMat);
      m.userData.pipe = i; frame.add(m);
    });
    Design.fittings(design).forEach(f => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(f.type === 'cap' ? 0.0135 : 0.0165, 12, 10), fitMat);
      m.position.copy(V3(...f.p).multiplyScalar(IN)); frame.add(m);
    });
    const parts = new THREE.Group(); root.add(parts);
    const map = {};
    let fi = 0;
    design.parts.forEach(p => {
      if (!PARTS[p.type]) return;
      const m = partMesh(p, PARTS[p.type].kind === 'float' ? fi++ : 0);
      parts.add(m); map[p.id] = m;
    });
    root.userData.parts = map;
    if (opts.offset) root.children.forEach(c => c.position.sub(opts.offset));
    return root;
  }

  /* ---------- Pool scenes ---------- */
  function tileTexture(opts) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = opts.base; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = opts.grout; g.lineWidth = 3;
    for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }

  function textSprite(text, color, size) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const g = c.getContext('2d'); g.fillStyle = color || '#123'; g.font = 'bold 72px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size || 0.6, (size || 0.6) / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    return m;
  }

  /* spec: { x0,x1,z0,z1, depth(z) -> metres, lanes?, finish? } Start wall is z = z1. */
  function buildPool(spec) {
    const g = new THREE.Group();
    const W = spec.x1 - spec.x0, L = spec.z1 - spec.z0;
    const floorTex = tileTexture({ base: '#8fd3e8', grout: '#6fb9d1' });
    floorTex.repeat.set(W / 1.0, L / 1.0);
    // floor as a strip that follows depth(z)
    const nz = 60;
    const geo = new THREE.PlaneGeometry(W, L, 1, nz);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), ly = pos.getY(i);
      const z = spec.z1 - (ly + L / 2) / L * L; // ly from -L/2..L/2 maps z1..z0
      pos.setXYZ(i, lx + (spec.x0 + spec.x1) / 2, -spec.depth(z), z);
    }
    geo.computeVertexNormals();
    const floor = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85, side: THREE.DoubleSide }));
    g.add(floor);
    // lane lines on the floor
    const laneMat = new THREE.MeshBasicMaterial({ color: 0x1b2a6b });
    const laneXs = spec.lanes || [];
    laneXs.forEach(x => {
      for (let z = spec.z0 + 0.5; z < spec.z1 - 0.5; z += 0.25) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.26), laneMat);
        s.rotation.x = -Math.PI / 2; s.position.set(x, -spec.depth(z) + 0.004, z); g.add(s);
      }
    });
    // walls
    const wallTex = tileTexture({ base: '#d9f1f7', grout: '#b7dbe6' });
    const maxD = Math.max(spec.depth(spec.z0), spec.depth(spec.z1), spec.depth((spec.z0 + spec.z1) / 2)) + 0.4;
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.8, side: THREE.DoubleSide });
    const mkWall = (w, h, x, y, z, ry) => {
      const t = wallTex.clone(); t.needsUpdate = true; t.repeat.set(w, h);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
    };
    const top = 0.3;
    mkWall(W, maxD + top, (spec.x0 + spec.x1) / 2, (top - maxD) / 2, spec.z0, 0);
    mkWall(W, maxD + top, (spec.x0 + spec.x1) / 2, (top - maxD) / 2, spec.z1, Math.PI);
    mkWall(L, maxD + top, spec.x0, (top - maxD) / 2, (spec.z0 + spec.z1) / 2, Math.PI / 2);
    mkWall(L, maxD + top, spec.x1, (top - maxD) / 2, (spec.z0 + spec.z1) / 2, -Math.PI / 2);
    // depth markers on the side walls
    [spec.z1 - 0.6, (spec.z0 + spec.z1) / 2, spec.z0 + 0.6].forEach(z => {
      const ft = Math.round(spec.depth(z) / 0.3048 * 2) / 2;
      [spec.x0 + 0.01, spec.x1 - 0.01].forEach((x, i) => {
        const s = textSprite(ft + ' FT', '#0d2b4d', 0.7);
        s.position.set(x, 0.12, z); s.rotation.y = i ? -Math.PI / 2 : Math.PI / 2; g.add(s);
      });
    });
    // black target line on the wall at the deep end
    // deck
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xa9a294, roughness: 0.95 });
    const deckW = 3;
    const deck = (w, l, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, l), deckMat); m.position.set(x, top - 0.05, z); g.add(m); };
    deck(W + 2 * deckW, deckW, (spec.x0 + spec.x1) / 2, spec.z1 + deckW / 2);
    deck(W + 2 * deckW, deckW, (spec.x0 + spec.x1) / 2, spec.z0 - deckW / 2);
    deck(deckW, L, spec.x0 - deckW / 2, (spec.z0 + spec.z1) / 2);
    deck(deckW, L, spec.x1 + deckW / 2, (spec.z0 + spec.z1) / 2);
    // water surface (seen from above and below)
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W, L, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1e7f9c, transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    water.rotation.x = -Math.PI / 2; water.position.set((spec.x0 + spec.x1) / 2, 0, (spec.z0 + spec.z1) / 2); water.renderOrder = 2;
    g.add(water);
    g.userData.water = water;
    if (spec.finish != null) {
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.12), new THREE.MeshBasicMaterial({ color: 0xd01f2f }));
      fl.rotation.x = -Math.PI / 2; fl.position.set((spec.x0 + spec.x1) / 2, -spec.depth(spec.finish) + 0.006, spec.finish); g.add(fl);
      const flS = rod(V3(spec.x0, 0.02, spec.finish), V3(spec.x1, 0.02, spec.finish), 0.02, mat('finrope', 0xd01f2f));
      g.add(flS);
    }
    (spec.ropes || []).forEach(x => {
      for (let z = spec.z0 + 0.1; z < spec.z1 - 0.05; z += 0.12) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8), mat('rope' + (Math.floor(z * 4) % 3), [0xd01f2f, 0xf6f6f0, 0x1b4fc2][Math.abs(Math.floor(z * 8)) % 3]));
        b.rotation.x = Math.PI / 2; b.position.set(x, 0, z); g.add(b);
      }
    });
    return g;
  }

  /* ---------- Apparatus ---------- */
  function hoopMesh(diam) {
    const g = new THREE.Group();
    const tube = 0.012, R = diam / 2 + tube;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, tube, 10, 64), mat('hoop', 0x2f8f3a, { roughness: 0.5 }));
    g.add(ring);
    const flo = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 12), mat('hoopfloat', 0xf07b1a));
    flo.rotation.z = Math.PI / 2; flo.position.y = R + 0.03; g.add(flo);
    return g;
  }

  // 6" diving ring: weighted at the bottom with a float in the white tab, so it stands upright on the pool floor.
  // The ring lies in its local XY plane (hole faces local z) with the tab at the top.
  const RING_R = 0.07, RING_T = 0.0085;
  function ringMesh(color) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusGeometry(RING_R, RING_T, 10, 36), mat('ring' + color, color, { roughness: 0.4 })));
    const tab = new THREE.Mesh(new THREE.CylinderGeometry(RING_T * 1.55, RING_T * 1.55, 0.036, 14), mat('ringTab', 0xf4f4f0, { roughness: 0.6 }));
    tab.rotation.z = Math.PI / 2; tab.position.y = RING_R;
    g.add(tab);
    return g;
  }

  function tipUpMesh() {
    const g = new THREE.Group();
    const pvc = mat('pvc', 0xf6f6f0);
    const w = 18 * IN, d = 13 * IN, r = 0.0134; // ¾" pipe
    const c = [V3(-w / 2, 0.02, -d / 2), V3(w / 2, 0.02, -d / 2), V3(w / 2, 0.02, d / 2), V3(-w / 2, 0.02, d / 2)];
    for (let i = 0; i < 4; i++) g.add(rod(c[i], c[(i + 1) % 4], r, pvc));
    // side rails extend back (the long arms in the drawing)
    g.add(rod(V3(-w / 2, 0.02, -d / 2), V3(-w / 2, 0.02, -d / 2 - 0.35), r, pvc));
    g.add(rod(V3(w / 2, 0.02, -d / 2), V3(w / 2, 0.02, -d / 2 - 0.35), r, pvc));
    // pool noodle floats
    [-1, 1].forEach(s => {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, d * 0.8, 9), mat('noodleG', 0xa5d6a7, { roughness: 0.9 }));
      n.rotation.x = Math.PI / 2; n.position.set(s * w / 2, 0.03, 0); g.add(n);
    });
    // yellow tip-up base
    const base = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75, 0.02, 0.05), mat('tipup', 0xf2c21b));
    base.position.y = 0.045; g.add(base);
    const base2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, d * 0.9), mat('tipup', 0xf2c21b));
    base2.position.y = 0.045; g.add(base2);
    // spool shaft and spool under water
    const shaftLen = 0.2;
    g.add(rod(V3(0, 0.05, 0), V3(0, -shaftLen, 0), 0.0048, mat('steel', 0x9aa3ab, { metalness: 0.7, roughness: 0.35 })));
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.0254, 0.0254, 0.03, 16), mat('spool', 0x2b2b2b));
    spool.position.y = -shaftLen; g.add(spool);
    const spoolMark = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.008, 0.008), mat('spoolmark', 0xff3b30));
    spoolMark.position.y = -shaftLen; g.add(spoolMark);
    g.userData.spool = spool; g.userData.spoolMark = spoolMark; g.userData.spoolY = -shaftLen;
    // flag on its wire arch
    const flag = new THREE.Group();
    const wire = rod(V3(0, 0, 0), V3(0, 0.3, 0), 0.0025, mat('wire', 0x666666));
    flag.add(wire);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.07), new THREE.MeshStandardMaterial({ color: 0x1fa64a, side: THREE.DoubleSide }));
    cloth.position.set(0.05, 0.26, 0); flag.add(cloth);
    flag.position.set(0, 0.055, 0); flag.rotation.z = -1.45; // folded down, held by the T bar
    g.add(flag); g.userData.flag = flag;
    // J hooks: left bowl 11" down, right bowl 8" down (front view in the parameters)
    const hooks = [];
    [[-1, 11], [1, 8]].forEach(([s, drop]) => {
      const x = s * w / 2, z = d / 2, y0 = 0.02, yb = y0 - drop * IN;
      g.add(rod(V3(x, y0, z), V3(x, yb, z), 0.0107, pvc));
      const bowl = new THREE.Mesh(new THREE.TorusGeometry(1.69 * IN, 0.0107, 8, 20, Math.PI), pvc);
      bowl.rotation.y = Math.PI / 2; bowl.rotation.z = Math.PI; bowl.position.set(x, yb, z + 1.69 * IN); g.add(bowl);
      const tip = V3(x, yb + 0.02, z + 3.375 * IN);
      g.add(rod(V3(x, yb, z + 3.375 * IN), tip, 0.0107, pvc));
      hooks.push({ bowl: V3(x, yb - 1.69 * IN * 0.6, z + 1.69 * IN), tip: tip.clone(), side: s, rings: [], drop });
    });
    g.userData.hooks = hooks;
    return g;
  }

  // Reef arms as paths in the arm's local frame (u outward, v up, w sideways). The ring sits at s0 metres along the path.
  const ARMS = [
    { color: 'green',  hex: 0x2fa84f, pts: [[0, 0, 0], [0.45, 0, 0], [0.45, -0.14, 0]], s0: 0.3, pts2: 10 },
    { color: 'blue',   hex: 0x2277d6, pts: [[0, 0, 0], [0.4, 0, 0], [0.4, 0.16, 0], [0.56, 0.16, 0], [0.56, -0.06, 0]], s0: 0.27 },
    { color: 'yellow', hex: 0xf2c21b, pts: [[0, 0, 0], [0.38, 0, 0], [0.5, 0, 0.14], [0.5, 0, 0.34], [0.5, -0.12, 0.34]], s0: 0.26 },
    { color: 'red',    hex: 0xd6332e, pts: [[0, 0, 0], [0.34, 0, 0], [0.34, 0.14, 0], [0.48, 0.14, 0], [0.48, 0.14, 0.14], [0.48, -0.04, 0.14], [0.6, -0.04, 0.14], [0.6, -0.16, 0.14]], s0: 0.24 }
  ];

  function reefMesh(armDefs) {
    const g = new THREE.Group();
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), mat('pvcfit', 0xdedbd2));
    g.add(node);
    const paths = [];
    armDefs.forEach((A, i) => {
      const ang = i * Math.PI / 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const toWorld = p => V3(p[0] * ca - p[2] * sa, p[1], -(p[0] * sa + p[2] * ca));
      const pts = A.pts.map(toWorld);
      const m = mat('arm' + A.color, A.hex, { roughness: 0.5 });
      for (let k = 0; k < pts.length - 1; k++) g.add(rod(pts[k], pts[k + 1], 0.0107, m));
      for (let k = 1; k < pts.length - 1; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), m); s.position.copy(pts[k]); g.add(s); }
      // noodle flotation near the center
      const nood = rod(toWorld([0.06, 0, 0]), toWorld([0.2, 0, 0]), 0.036, mat('noodleL', 0xc7b3f0, { roughness: 0.9 }), 10);
      g.add(nood);
      // black couplings either side of the ring spot
      const path = makePath(pts);
      [-0.045, 0.045].forEach(ds => {
        const p = pointAt(path, A.s0 + ds), dir = dirAt(path, A.s0 + ds);
        const cpl = rod(p.clone().addScaledVector(dir, -0.012), p.clone().addScaledVector(dir, 0.012), 0.015, mat('coupler', 0x151515));
        g.add(cpl);
      });
      paths.push(Object.assign(path, { color: A.color, hex: A.hex, s0: A.s0, value: [10, 20, 30, 40][i] }));
    });
    g.userData.paths = paths;
    return g;
  }

  function makePath(pts) {
    const segs = []; let total = 0;
    for (let i = 0; i < pts.length - 1; i++) { const L = pts[i].distanceTo(pts[i + 1]); segs.push({ a: pts[i], b: pts[i + 1], s: total, L }); total += L; }
    return { pts, segs, length: total };
  }
  function pointAt(path, s) {
    s = Math.max(0, Math.min(path.length, s));
    for (const g of path.segs) if (s <= g.s + g.L + 1e-9) return g.a.clone().lerp(g.b, (s - g.s) / g.L);
    return path.pts[path.pts.length - 1].clone();
  }
  function dirAt(path, s) {
    s = Math.max(0, Math.min(path.length - 1e-6, s));
    for (const g of path.segs) if (s <= g.s + g.L) return g.b.clone().sub(g.a).normalize();
    const g = path.segs[path.segs.length - 1]; return g.b.clone().sub(g.a).normalize();
  }
  // nearest path position to point p (local coords), searching near s
  function project(path, p, sNear, win) {
    let best = { s: sNear, d: Infinity };
    for (const g of path.segs) {
      if (g.s > sNear + win || g.s + g.L < sNear - win) continue;
      const ab = g.b.clone().sub(g.a);
      let t = p.clone().sub(g.a).dot(ab) / (g.L * g.L);
      t = Math.max(0, Math.min(1, t));
      const s = g.s + t * g.L;
      if (Math.abs(s - sNear) > win) continue;
      const d = g.a.clone().lerp(g.b, t).distanceTo(p);
      if (d < best.d) best = { s, d };
    }
    return best;
  }

  function sacMesh(hex, size) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 8, 24), mat('sacring', 0x8c8c8c, { metalness: 0.6 }));
    g.add(ring);
    const bag = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(size / 2, 14, 12), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.45, roughness: 0.9, wireframe: false, depthWrite: false }));
    shell.scale.set(1, 1.2, 0.7); bag.add(shell);
    const net = new THREE.Mesh(new THREE.SphereGeometry(size / 2 + 0.002, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }));
    net.scale.set(1, 1.2, 0.7); bag.add(net);
    const n = Math.round(size * 30);
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), mat('egg' + hex, hex, { roughness: 0.4 }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * size * 0.35, h = (Math.random() - 0.5) * size * 0.6;
      b.position.set(Math.cos(a) * r, h, Math.sin(a) * r * 0.6); bag.add(b);
    }
    bag.position.y = size * 0.6 + 0.05;
    g.add(bag);
    g.userData.bag = bag;
    return g;
  }

  Object.assign(U, { World: { RING_R, RING_T, mat, rod, buildRov, partMesh, buildPool, hoopMesh, ringMesh, tipUpMesh, reefMesh, sacMesh, textSprite, ARMS, makePath, pointAt, dirAt, project, rulerTexture } });
})();
