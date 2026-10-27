/* Pools and the four 2026-27 Underwater IVD challenges, plus a test tank and an open practice pool.
   Rules and points follow the 2026-27 competition parameters (V1.0, Sept 23 2026). */
(function () {
  const U = window.UIVD;
  const { IN, World, Physics, PARTS } = U;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const rand = (a, b) => a + Math.random() * (b - a);
  const RING_COLORS = [0x2fbf4a, 0xff6f91, 0xffd23f, 0x3b82f6];

  const POOLS = {
    tank: { x0: -1.5, x1: 1.5, z0: -3, z1: 0, depth: () => 1.5 },
    comp: { x0: -6, x1: 6, z0: -16, z1: 0, depth: z => z > -4 ? 1.2 : z > -10 ? 1.2 + (-4 - z) / 6 * 2.4 : 3.6 },
    drag: { x0: -5, x1: 5, z0: -12, z1: 0, depth: () => 2.0, lanes: [-3.75, -1.25, 1.25, 3.75], ropes: [-2.5, 0, 2.5], finish: -25 * 0.3048 }
  };

  function capsulesFromMesh(list, a, b, r) { list.push({ a, b, r }); }

  /* ---------- shared helpers ---------- */
  function toolWorld(M, t) {
    return {
      tip: Physics.worldOf(M.rov, t.tip),
      mount: Physics.worldOf(M.rov, t.mount),
      dir: t.dir.clone().applyQuaternion(M.rov.qn)
    };
  }
  function nearWallAtSurface(M, margin) {
    const p = M.rov.p, P = M.pool;
    const d = Math.min(p.x - P.x0, P.x1 - p.x, p.z - P.z0, P.z1 - p.z);
    return d < margin && p.y > -0.45;
  }
  function atStart(M) {
    const p = M.rov.p;
    return Math.hypot(p.x - M.start.x, p.z - M.start.z) < 1.2 && p.y > -0.5;
  }
  function vel(M, wp) {
    const rel = wp.clone().sub(M.rov.p);
    return new THREE.Vector3().crossVectors(M.rov.w.clone().applyQuaternion(M.rov.qn), rel).add(M.rov.v);
  }

  /* ---------- rings and the tip-up (Challenge #2) ---------- */
  function setupFlag(M, origin, ringArea, count) {
    if (count == null) count = 10;
    const tip = World.tipUpMesh();
    tip.position.copy(origin);
    M.scene.add(tip);
    const s = M.state;
    s.tip = tip; s.flagUp = false; s.spoolAngle = 0; s.flagAnim = 0;
    const W = 18 * IN, D = 13 * IN, o = origin;
    const ob = M.env.obstacles;
    const C = [V3(-W / 2, 0.02, -D / 2), V3(W / 2, 0.02, -D / 2), V3(W / 2, 0.02, D / 2), V3(-W / 2, 0.02, D / 2)].map(v => v.add(o));
    for (let i = 0; i < 4; i++) capsulesFromMesh(ob, C[i], C[(i + 1) % 4], 0.016);
    capsulesFromMesh(ob, V3(-W / 2, 0.03, -D / 2 - 0.35).add(o), V3(-W / 2, 0.03, D / 2).add(o), 0.036);
    capsulesFromMesh(ob, V3(W / 2, 0.03, -D / 2 - 0.35).add(o), V3(W / 2, 0.03, D / 2).add(o), 0.036);
    tip.userData.hooks.forEach(h => {
      h.world = h.bowl.clone().add(o);
      capsulesFromMesh(ob, V3(h.side * W / 2, 0.02, D / 2).add(o), V3(h.side * W / 2, 0.02 - h.drop * IN, D / 2).add(o), 0.012);
    });
    s.hooks = tip.userData.hooks;
    s.spoolTop = V3(0, 0.0, 0).add(o); s.spoolBot = V3(0, tip.userData.spoolY - 0.015, 0).add(o);
    capsulesFromMesh(ob, s.spoolTop, s.spoolBot, 0.006);
    // 10 standard 6" diving rings on the floor
    s.rings = [];
    for (let i = 0; i < count; i++) {
      let x, z, ok = false, tries = 0;
      while (!ok && tries++ < 200) {
        x = rand(ringArea.x0, ringArea.x1); z = rand(ringArea.z0, ringArea.z1);
        ok = s.rings.every(r => Math.hypot(r.pos.x - x, r.pos.z - z) > 0.45) && Math.hypot(x - o.x, z - o.z) > 0.8 && (!M.state.hoopAt || Math.hypot(x - M.state.hoopAt.x, z - M.state.hoopAt.z) > 1);
      }
      const mesh = World.ringMesh(RING_COLORS[i % 4]);
      const pos = V3(x, -M.pool.depth(z) + 0.012, z);
      mesh.position.copy(pos); mesh.rotation.x = Math.PI / 2; mesh.rotation.z = rand(0, 3);
      M.scene.add(mesh);
      s.rings.push({ i, mesh, pos, st: 'floor', vy: 0 });
    }
  }

  function stepRings(M, dt) {
    const s = M.state, rov = M.rov;
    if (!s.rings) return;
    const tools = rov.tools;
    for (const t of tools) {
      const W = toolWorld(M, t);
      t.world = W;
      if (t.type === 'prong') {
        // hook rings lying on the floor
        if (t.carried.length < t.P.cap) {
          for (const r of s.rings) {
            if (r.st !== 'floor' && r.st !== 'falling') continue;
            const fl = -M.pool.depth(r.pos.z);
            const dh = Math.hypot(W.tip.x - r.pos.x, W.tip.z - r.pos.z);
            if (dh < 0.055 && W.tip.y < r.pos.y + 0.05 && W.tip.y > fl - 0.05) {
              r.st = 'prong'; r.tool = t; t.carried.push(r);
              M.event('Ring hooked (' + t.carried.length + ' on the prong)');
              if (t.carried.length >= t.P.cap) break;
            }
          }
        }
        // rings slide off a prong that points down
        if (t.carried.length && W.dir.y < -0.55) {
          t.slide = (t.slide || 0) + dt;
          if (t.slide > 0.35) { t.slide = 0; const r = t.carried.pop(); r.st = 'falling'; r.vy = 0; r.pos.copy(W.tip); M.event('A ring slid off the prong'); }
        } else t.slide = 0;
      }
      if (t.type === 'claw' && t.held && t.held.kind === 'ring') {
        const r = t.held.ref; r.pos.copy(W.tip);
      }
    }
    // spool turning: tangential motion of anything touching the shaft turns the spool
    if (!s.flagUp && s.spoolTop) {
      const axisX = s.spoolTop.x, axisZ = s.spoolTop.z;
      let contact = false;
      const pts = [];
      tools.forEach(t => pts.push({ p: t.world.tip, r: t.type === 'fork' ? 0.05 : 0.025 }));
      rov.els.forEach(e => { if (e.src === 'pipe' || e.src === 'fit') pts.push({ p: Physics.worldOf(rov, e.rel), r: e.r + 0.008 }); });
      for (const q of pts) {
        if (q.p.y > s.spoolTop.y + 0.02 || q.p.y < s.spoolBot.y - 0.04) continue;
        const dx = q.p.x - axisX, dz = q.p.z - axisZ, d = Math.hypot(dx, dz);
        if (d < q.r + 0.03 && d > 1e-4) {
          const v = vel(M, q.p);
          const tang = (-dz * v.x + dx * v.z) / d; // counter-clockwise from above is positive
          s.spoolAngle += tang * dt / 0.03;
          contact = true;
          break;
        }
      }
      s.spoolContact = contact;
      s.tip.userData.spoolMark.rotation.y = s.spoolAngle;
      if (Math.abs(s.spoolAngle) > Math.PI / 2) { s.flagUp = true; M.event('Flag released! +50', 'good'); M.sound && M.sound('flag'); }
    }
    if (s.flagUp && s.flagAnim < 1) { s.flagAnim = Math.min(1, s.flagAnim + dt * 3); s.tip.userData.flag.rotation.z = -1.45 * (1 - s.flagAnim); }
    // falling rings sink back to the floor
    for (const r of s.rings) {
      if (r.st === 'falling') {
        r.vy = Math.max(r.vy - 0.6 * dt, -0.25);
        r.pos.y += r.vy * dt;
        const fl = -M.pool.depth(r.pos.z) + 0.012;
        if (r.pos.y <= fl) { r.pos.y = fl; r.st = 'floor'; }
      }
    }
    // draw rings
    for (const r of s.rings) {
      const m = r.mesh;
      if (r.st === 'floor' || r.st === 'falling') { m.position.copy(r.pos); m.rotation.set(Math.PI / 2, 0, r.i); m.visible = true; }
      else if (r.st === 'prong') {
        const t = r.tool, W = t.world, k = t.carried.indexOf(r);
        const along = t.P.tipLen * (0.82 - k * 0.11);
        m.position.copy(W.mount).addScaledVector(W.dir, along).add(V3(0, -0.055, 0));
        m.quaternion.setFromUnitVectors(V3(0, 0, 1), W.dir);
        r.pos.copy(m.position);
        m.visible = true;
      } else if (r.st === 'claw') { m.position.copy(r.pos); m.rotation.set(0.2, 0, 0); m.visible = true; }
      else if (r.st === 'hook') {
        const h = s.hooks[r.hook], k = h.rings.indexOf(r);
        m.position.copy(h.world).add(V3((k - (h.rings.length - 1) / 2) * 0.012, -0.055, 0));
        m.rotation.set(0, 0, 0); m.visible = true;
      } else if (r.st === 'shore') m.visible = false;
    }
  }

  // H key: slide a ring off the prong onto a J hook, or open the claw over the hook
  function hangRing(M) {
    const s = M.state;
    for (const t of M.rov.tools) {
      if (!t.world) continue;
      for (let hi = 0; hi < s.hooks.length; hi++) {
        const h = s.hooks[hi];
        if (t.type === 'prong' && t.carried.length && t.world.tip.distanceTo(h.world) < 0.09) {
          const r = t.carried.pop(); r.st = 'hook'; r.hook = hi; h.rings.push(r);
          M.event('Ring on the hook! +15', 'good'); M.sound && M.sound('ring'); return true;
        }
      }
    }
    return false;
  }

  function handToTeammate(M) {
    if (!nearWallAtSurface(M, 0.9)) { M.event('Bring the ROV to the surface next to the pool edge first.'); return; }
    let n = 0;
    const s = M.state;
    M.rov.tools.forEach(t => {
      if (t.carried) { t.carried.forEach(r => { r.st = 'shore'; n++; }); t.carried = []; }
      if (t.held && t.held.kind === 'ring') { t.held.ref.st = 'shore'; t.held = null; t.closed = false; n++; }
      if (t.held && t.held.kind === 'sac') { const c = t.held.ref; c.st = 'shore'; c.delivered = true; t.held = null; t.closed = false; M.event(`${c.color} egg sac delivered to shore! +${c.value}`, 'good'); }
    });
    if (s.rings && n) { s.shoreRings = (s.shoreRings || 0) + n; M.event(`${n} ring${n > 1 ? 's' : ''} handed to a teammate. +${5 * n} (no time bonus now)`, 'good'); }
    else if (!n) M.event('Nothing to hand over.');
  }

  /* ---------- the hoop (Challenge #1) ---------- */
  function setupHoop(M, at) {
    const s = M.state;
    const d = Math.round(rand(0.36, 0.84) * 200) / 200; // inside diameter, metres
    s.hoopD = d; s.hoopArea = Math.PI * d * d / 4; s.hoopAt = at;
    const fl = -M.pool.depth(at.z);
    const R = d / 2 + 0.012;
    const cy = fl + 0.35 + R;
    const yaw = rand(-0.9, 0.9);
    const g = World.hoopMesh(d);
    g.position.set(at.x, cy, at.z); g.rotation.y = yaw;
    M.scene.add(g);
    const stem = World.rod(V3(at.x, cy - R, at.z), V3(at.x, fl + 0.08, at.z), 0.012, World.mat('stem', 0x222222));
    M.scene.add(stem);
    const anchor = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.16, 16), World.mat('anchor', 0x1a1a1a));
    anchor.position.set(at.x, fl + 0.08, at.z); M.scene.add(anchor);
    const n = 28, pts = [];
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI * 2;
      pts.push(V3(Math.cos(a) * R, Math.sin(a) * R, 0).applyAxisAngle(V3(0, 1, 0), yaw).add(V3(at.x, cy, at.z)));
    }
    for (let i = 0; i < n; i++) M.env.obstacles.push({ a: pts[i], b: pts[i + 1], r: 0.013 });
    M.env.obstacles.push({ a: V3(at.x, cy - R, at.z), b: V3(at.x, fl, at.z), r: 0.014 });
    M.env.obstacles.push({ a: V3(at.x, fl, at.z), b: V3(at.x, fl + 0.16, at.z), r: 0.09 });
    M.env.obstacles.push({ a: pts[n / 4 | 0].clone().add(V3(0, 0.03, 0)), b: pts[n / 4 | 0].clone().add(V3(0, 0.03, 0)), r: 0.04 });
  }

  /* ---------- the reef (Challenge #3) ---------- */
  function setupReef(M, at, depth) {
    const s = M.state;
    const order = [0, 1, 2, 3];
    const reef = World.reefMesh(World.ARMS);
    reef.position.set(at.x, -depth, at.z);
    reef.rotation.y = rand(0, Math.PI * 2);
    reef.updateMatrixWorld(true);
    M.scene.add(reef);
    s.reef = reef; s.reefInv = reef.matrixWorld.clone().invert();
    const fl = -M.pool.depth(at.z);
    const tether = World.rod(V3(at.x, -depth, at.z), V3(at.x, fl + 0.1, at.z), 0.004, World.mat('line', 0x222222));
    M.scene.add(tether);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.15, 0.25), World.mat('anchor', 0x1a1a1a));
    block.position.set(at.x, fl + 0.075, at.z); M.scene.add(block);
    const ob = M.env.obstacles, toW = p => p.clone().applyMatrix4(reef.matrixWorld);
    ob.push({ a: V3(at.x, -depth, at.z), b: V3(at.x, fl, at.z), r: 0.006 });
    ob.push({ a: V3(at.x, fl, at.z), b: V3(at.x, fl + 0.15, at.z), r: 0.14 });
    ob.push({ a: toW(V3(0, 0, 0)), b: toW(V3(0, 0, 0)), r: 0.035 });
    s.sacs = [];
    reef.userData.paths.forEach((path, i) => {
      path.segs.forEach(g => ob.push({ a: toW(g.a), b: toW(g.b), r: 0.012 }));
      const ang = i * Math.PI / 2;
      ob.push({ a: toW(V3(0.06 * Math.cos(ang), 0, -0.06 * Math.sin(ang))), b: toW(V3(0.2 * Math.cos(ang), 0, -0.2 * Math.sin(ang))), r: 0.036 });
      const size = [0.22, 0.3, 0.38, 0.46][order[(i + 1) % 4]] * rand(0.9, 1.1);
      const mesh = World.sacMesh(path.hex, size);
      M.scene.add(mesh);
      s.sacs.push({ path, color: path.color, value: path.value, s: path.s0, st: 'arm', mesh, size, lift: size * 9, pos: V3(0, 0, 0), vel: V3(0, 0, 0), released: false, delivered: false, engaged: null });
    });
  }

  function stepSacs(M, dt) {
    const s = M.state;
    if (!s.sacs) return;
    const rov = M.rov;
    rov.tools.forEach(t => { t.world = toolWorld(M, t); });
    const P = M.pool;
    M.env.ext = [];
    for (const c of s.sacs) {
      if (c.st === 'arm') {
        // engage: a prong tip through the ring, or a claw holding it
        if (!c.engaged) {
          for (const t of rov.tools) {
            if (t.type !== 'prong') continue;
            const local = t.world.tip.clone().applyMatrix4(s.reefInv);
            const ringPt = World.pointAt(c.path, c.s);
            if (local.distanceTo(ringPt) < 0.05) { c.engaged = t; M.event(`Prong is through the ${c.color} ring. Follow the arm’s shape to slide it off.`); break; }
          }
        }
        if (c.engaged) {
          const t = c.engaged;
          const local = t.world.tip.clone().applyMatrix4(s.reefInv);
          const pr = World.project(c.path, local, c.s, 0.1);
          if (pr.d > 0.09 || (t.type === 'claw' && t.held !== c.hold)) {
            if (t.type === 'claw' && t.held && t.held.ref === c) { t.held = null; t.closed = false; }
            c.engaged = null; M.event(`Lost the ${c.color} ring. It is still on the arm.`);
          } else {
            c.s = Math.max(0.05, pr.s);
            const past = local.distanceTo(World.pointAt(c.path, c.path.length));
            if (c.s >= c.path.length - 0.01 && (pr.d > 0.03 || past > 0.03)) {
              c.released = true; M.event(`${c.color} egg sac released! +${c.value}`, 'good'); M.sound && M.sound('ring');
              if (t.type === 'claw' && t.held && t.held.ref === c) c.st = 'held';
              else { c.st = 'free'; c.vel.set(0, 0.05, 0); }
              c.engaged = null;
            }
          }
        }
        c.pos.copy(World.pointAt(c.path, c.s)).applyMatrix4(s.reef.matrixWorld);
      } else if (c.st === 'held') {
        const t = rov.tools.find(x => x.held && x.held.ref === c);
        if (!t) { c.st = 'free'; continue; }
        c.pos.copy(t.world.tip);
        M.env.ext.push({ f: V3(0, c.lift, 0), p: c.pos.clone() });
      } else if (c.st === 'free') {
        // buoyant sac rises, then floats at the surface; the ROV can push it
        const bagC = c.pos.clone().add(V3(0, c.size * 0.6 + 0.05, 0));
        const top = bagC.y + c.size * 0.6;
        const targetVy = top < 0 ? 0.22 : 0;
        c.vel.y += (targetVy - c.vel.y) * Math.min(1, dt * 2);
        if (top >= 0 && c.vel.y > 0) c.vel.y = 0;
        c.vel.x *= Math.exp(-dt * 0.8); c.vel.z *= Math.exp(-dt * 0.8);
        for (const e of rov.els) {
          const wp = Physics.worldOf(rov, e.rel);
          const d = wp.distanceTo(bagC);
          if (d < c.size * 0.5 + e.r) {
            const v = vel(M, wp);
            const n = bagC.clone().sub(wp).normalize();
            const push = Math.max(0, v.dot(n)) + 0.05;
            c.vel.addScaledVector(n, push * 0.6);
          }
        }
        c.pos.addScaledVector(c.vel, dt);
        if (c.pos.y + c.size * 1.2 + 0.05 > 0.02) c.pos.y = Math.min(c.pos.y, 0.02 - c.size * 1.2 - 0.05);
        c.pos.x = Math.max(P.x0 + 0.1, Math.min(P.x1 - 0.1, c.pos.x));
        c.pos.z = Math.max(P.z0 + 0.1, Math.min(P.z1 - 0.1, c.pos.z));
        const atSurface = top > -0.08;
        const wall = Math.min(c.pos.x - P.x0, P.x1 - c.pos.x, c.pos.z - P.z0, P.z1 - c.pos.z);
        if (atSurface && wall < 0.4) { c.st = 'shore'; c.delivered = true; M.event(`A teammate grabbed the ${c.color} egg sac! +${c.value}`, 'good'); M.sound && M.sound('flag'); }
      }
      c.mesh.visible = c.st !== 'shore';
      c.mesh.position.copy(c.pos);
      if (c.st === 'arm') {
        const d = World.dirAt(c.path, c.s).transformDirection(s.reef.matrixWorld);
        c.mesh.quaternion.setFromUnitVectors(V3(0, 0, 1), d);
        c.mesh.userData.bag.quaternion.copy(c.mesh.quaternion).invert();
      } else { c.mesh.quaternion.identity(); c.mesh.userData.bag.quaternion.identity(); }
    }
  }

  /* ---------- claw (any mission) ---------- */
  function toggleClaw(M) {
    const claws = M.rov.tools.filter(t => t.type === 'claw');
    if (!claws.length) { M.event('This ROV has no claw.'); return; }
    const s = M.state;
    claws.forEach(t => {
      t.moving = 0.6;
      if (!t.world) t.world = toolWorld(M, t);
      if (t.closed) {
        t.closed = false;
        if (t.held) {
          const h = t.held; t.held = null;
          if (h.kind === 'ring') {
            const r = h.ref;
            const hi = s.hooks ? s.hooks.findIndex(k => k.world.distanceTo(t.world.tip) < 0.1) : -1;
            if (hi >= 0) { r.st = 'hook'; r.hook = hi; s.hooks[hi].rings.push(r); M.event('Ring on the hook! +15', 'good'); M.sound && M.sound('ring'); }
            else { r.st = 'falling'; r.vy = 0; M.event('Ring dropped.'); }
          } else if (h.kind === 'sac') {
            const c = h.ref;
            if (c.st === 'held') { c.st = 'free'; c.vel.set(0, 0, 0); }
            else if (c.st === 'arm') { c.engaged = null; }
          }
        }
        return;
      }
      t.closed = true;
      const tip = t.world.tip;
      if (s.rings) {
        const r = s.rings.filter(r => r.st === 'floor' || r.st === 'falling').sort((a, b) => a.pos.distanceTo(tip) - b.pos.distanceTo(tip))[0];
        if (r && r.pos.distanceTo(tip) < 0.08) { r.st = 'claw'; t.held = { kind: 'ring', ref: r }; M.event('Ring in the claw.'); return; }
      }
      if (s.sacs) {
        for (const c of s.sacs) {
          if (c.st === 'arm' && c.pos.distanceTo(tip) < 0.07) { const hold = { kind: 'sac', ref: c }; t.held = hold; c.hold = hold; c.engaged = t; M.event(`Claw has the ${c.color} ring. Follow the arm to slide it off.`); return; }
          if (c.st === 'free' && c.pos.distanceTo(tip) < 0.12) { c.st = 'held'; t.held = { kind: 'sac', ref: c }; M.event(`Claw has the ${c.color} egg sac.`); return; }
        }
      }
    });
  }

  /* ---------- mission definitions ---------- */
  const MISSIONS = {
    tank: {
      id: 'tank', title: 'Test tank', short: 'Trim test', pool: 'tank', heatSec: 0, heats: 0, views: 'free',
      start: { x: 0, z: -1.5, y: -0.7, heading: 0 },
      desc: 'Check buoyancy and balance. Press Release and watch: a well-trimmed ROV rises very slowly and sits level.',
      setup(M) {
        const g = M.scene;
        for (let d = 0; d <= 1.5; d += 0.1) {
          const big = Math.round(d * 100) % 50 === 0;
          const m = new THREE.Mesh(new THREE.PlaneGeometry(big ? 0.3 : 0.15, 0.008), new THREE.MeshBasicMaterial({ color: 0x0d2b4d }));
          m.position.set(0, -d, -2.995); g.add(m);
          if (big) { const t = World.textSprite((d * 100).toFixed(0) + ' cm', '#0d2b4d', 0.32); t.position.set(0.32, -d, -2.99); g.add(t); }
        }
        M.state.hold = true;
      },
      step(M) { if (M.state.hold) { M.rov.p.set(0, -0.7, -1.5); M.rov.v.set(0, 0, 0); M.rov.w.set(0, 0, 0); M.rov.qn.identity(); } },
      actions: [{ key: 'Enter', label: 'Release', show: M => M.state.hold, run(M) { M.state.hold = false; M.event('Released. Watch which way it drifts and how it tilts.'); } },
                { key: 'Enter', label: 'Hold again', show: M => !M.state.hold, run(M) { M.state.hold = true; } }],
      score() { return null; }
    },

    practice: {
      id: 'practice', title: 'Practice pool', short: 'Practice', pool: 'comp', heatSec: 0, heats: 0, views: 'free',
      start: { x: 0, z: -0.6, y: -0.15, heading: 0 },
      desc: 'Everything from Challenges 1–3 in one pool, with no clock and every camera allowed. Rings, the tip-up, the hoop and the reef reset when you press Reset.',
      setup(M) {
        setupHoop(M, V3(-3.2, 0, -3.6));
        setupFlag(M, V3(2.2, 0, -5.2), { x0: -1.8, x1: 4.5, z0: -2.0, z1: -7.2 });
        setupReef(M, V3(0, 0, -12), rand(1.0, 2.6));
      },
      step(M, dt) { stepRings(M, dt); stepSacs(M, dt); },
      actions: [
        { key: 'h', label: 'Hang ring (H)', run: M => { if (!hangRing(M)) M.event('Put the prong tip right on a J hook first.'); } },
        { key: 't', label: 'Hand to teammate (T)', run: handToTeammate }
      ],
      score: M => liveCounts(M)
    },

    hoop: {
      id: 'hoop', title: 'Challenge #1: Hula Hoop Hustle', short: '#1 Hoop', pool: 'comp', heatSec: 600, heats: 1, views: 'heat',
      start: { x: 0, z: -0.6, y: -0.15, heading: 0 },
      desc: 'Dive to the hoop and measure its inside diameter with a measuring device on your ROV (a ruler or meter stick). Then calculate the area inside the hoop in square meters, rounded to the nearest hundredth. One 10-minute heat. Photos and scaling images are not allowed.',
      rules: ['10 minutes, starting when the ROV touches the water. One heat only.', 'Read the measurement directly off a device under water.', 'Answer in m², rounded to 0.01 m².', 'Score = 100 × (1 − |your answer − known value| ÷ known value). No negative scores.'],
      setup(M) { setupHoop(M, V3(0, 0, -4.6)); },
      step() {},
      actions: [],
      score(M) {
        const s = M.state;
        if (s.answer == null) return { rows: [{ label: 'Area answer', note: 'Enter it below when you are done measuring' }], total: null };
        const err = Math.abs(s.answer - s.hoopArea) / s.hoopArea;
        const sc = Math.max(0, Math.round(1000 * (1 - err)) / 10);
        return { rows: [{ label: 'Your answer', note: s.answer.toFixed(2) + ' m²' }, { label: 'Known value', note: s.hoopArea.toFixed(4) + ' m² (inside diameter ' + (s.hoopD * 100).toFixed(1) + ' cm)' }, { label: 'Percent error', note: (err * 100).toFixed(1) + '%' }], total: sc, final: true };
      }
    },

    flag: {
      id: 'flag', title: 'Challenge #2: Raising the “All Clear” Flag', short: '#2 Flag', pool: 'comp', heatSec: 900, heats: 2, views: 'heat',
      start: { x: 0, z: -0.6, y: -0.15, heading: 0 },
      desc: 'Collect the 10 diving rings (invasive Eurasian watermilfoil) from the pool floor and hang them on the tip-up’s J hooks, or hand them to a teammate at the pool edge. Turn the spool to release the flag. Return to the start to stop the clock.',
      rules: ['15 minutes per heat, two heats. Best heat counts.', '5 points per ring handed to a teammate (no time bonus after that).', '15 points per ring hanging on a hook at the end.', '50 points for raising the flag.', 'Time bonus (25 / 15 / 5) for the fastest teams with all 10 rings on hooks and the flag up.', '−20 for each peek at the pool and each diver assist.', 'Switch pilots at the 7 minute mark.'],
      setup(M) { setupFlag(M, V3(1.6, 0, -5.4), { x0: -3.5, x1: 3.5, z0: -2.0, z1: -7.6 }); },
      step(M, dt) { stepRings(M, dt); },
      actions: [
        { key: 'h', label: 'Hang ring (H)', run: M => { if (!hangRing(M)) M.event('Put the prong tip right on a J hook first.'); } },
        { key: 't', label: 'Hand to teammate (T)', run: handToTeammate }
      ],
      score(M) {
        const s = M.state;
        const shore = s.rings.filter(r => r.st === 'shore').length;
        const hook = s.rings.filter(r => r.st === 'hook').length;
        const rows = [
          { label: 'Rings to team member', each: 5, count: shore, pts: shore * 5 },
          { label: 'Rings on hook', each: 15, count: hook, pts: hook * 15 },
          { label: 'Release flag', each: 50, count: s.flagUp ? 1 : 0, pts: s.flagUp ? 50 : 0 }
        ];
        const pen = penaltyRows(M);
        const task = rows.reduce((a, r) => a + r.pts, 0), p = pen.reduce((a, r) => a + r.pts, 0);
        const complete = hook === 10 && s.flagUp && shore === 0;
        return { rows, pen, task, total: task + p, complete, bonusNote: complete ? 'Bonus eligible if you return to the start in under 15:00.' : 'Bonus needs all 10 rings on hooks, the flag up and no rings to shore.' };
      }
    },

    carp: {
      id: 'carp', title: 'Challenge #3: “Carp” Diem!', short: '#3 Carp', pool: 'comp', heatSec: 900, heats: 2, views: 'heat',
      start: { x: 0, z: -0.6, y: -0.15, heading: 0 },
      desc: 'Four Asian carp egg sacs hang from the arms of an underwater reef. Each arm is shaped differently. Slide each sac’s ring along its arm until it comes off, then get the floating sacs to a teammate at the pool edge.',
      rules: ['15 minutes per heat, two heats. Best heat counts.', 'Green 10, blue 20, yellow 30, red 40 points when released from the reef…', '…and the same points again when delivered to a teammate on shore.', 'Teammates may reach only 1 ft into the pool.', 'Time bonus (25 / 15 / 5) for the fastest teams with all four sacs delivered.', '−20 for each peek at the pool and each diver assist.', 'Switch pilots at the 7 minute mark.'],
      setup(M) { setupReef(M, V3(rand(-1.5, 1.5), 0, -12), rand(1.0, 2.8)); },
      step(M, dt) { stepSacs(M, dt); },
      actions: [{ key: 't', label: 'Hand sac to teammate (T)', run: handToTeammate }],
      score(M) {
        const s = M.state;
        const rows = s.sacs.map(c => ({ label: c.color[0].toUpperCase() + c.color.slice(1) + ' egg sac', each: c.value, count: (c.released ? 1 : 0) + (c.delivered ? 1 : 0), pts: (c.released ? c.value : 0) + (c.delivered ? c.value : 0), note: (c.released ? 'released' : 'on reef') + (c.delivered ? ' + delivered' : '') }));
        const pen = penaltyRows(M);
        const task = rows.reduce((a, r) => a + r.pts, 0), p = pen.reduce((a, r) => a + r.pts, 0);
        const complete = s.sacs.every(c => c.delivered);
        return { rows, pen, task, total: task + p, complete, bonusNote: complete ? 'Bonus eligible if you return to the start in under 15:00.' : 'Bonus needs all four sacs delivered to shore.' };
      }
    },

    drag: {
      id: 'drag', title: 'Challenge #4: Underwater Drag Race', short: '#4 Drag race', pool: 'drag', heatSec: 0, heats: 0, views: 'deck',
      start: { x: -1.25, z: -0.3, y: -0.8, heading: 0 },
      desc: 'Single elimination. The rear of your ROV starts touching the wall. At the signal, drive straight down your lane until the whole ROV crosses the line, about 25 ft away. Stay neutrally buoyant: dragging along the bottom or skimming the surface is a disqualification. The ROV must fit in a 24" cube. The pilot faces the pool, so the deck view is allowed.',
      rules: ['ROV must be smaller than a 24" cube.', 'Rear touching the wall at the start.', 'First ROV completely past the finish line wins.', 'Must stay neutrally buoyant: no driving on the bottom, no skimming the surface.', 'Same 12 V battery and 25 A fuse rules.'],
      setup(M) {
        const s = M.state;
        s.round = s.round || 0;
        const ghost = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.45), new THREE.MeshStandardMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.75 }));
        ghost.add(body);
        const lbl = World.textSprite('RIVAL', '#ffffff', 0.5); lbl.position.y = 0.25; ghost.add(lbl);
        ghost.position.set(1.25, -0.8, -0.23);
        M.scene.add(ghost); s.ghost = ghost;
        s.phase = 'ready';
      },
      step(M, dt) {
        const s = M.state, rov = M.rov;
        const rear = rearZ(M);
        if (s.phase === 'ready' || s.phase === 'countdown') {
          // a teammate holds the ROV against the wall until the signal
          rov.p.z += (-0.012 - rear); rov.v.set(0, 0, 0); rov.w.set(0, 0, 0);
          rov.p.x = M.start.x; rov.p.y = M.start.y;
          rov.qn.identity();
          if (s.phase === 'countdown') { s.cd -= dt; if (s.cd <= 0) { s.phase = 'race'; s.t = 0; s.floorT = 0; s.surfT = 0; M.event('GO!', 'good'); M.sound && M.sound('go'); } }
          return;
        }
        if (s.phase !== 'race') return;
        s.t += dt;
        const T = s.rivalT, tau = 1.0, v = 7.62 / (T - tau * (1 - Math.exp(-T / tau)));
        const gz = -v * (s.t - tau * (1 - Math.exp(-s.t / tau)));
        s.ghost.position.z = -0.23 + gz;
        if (rov.contact.floor) s.floorT += dt;
        if (rov.contact.surface) s.surfT += dt;
        if (s.floorT > 1.0) return finishRace(M, 'dq', 'Disqualified: the ROV drove along the bottom. Drag racers must be neutrally buoyant.');
        if (s.surfT > 1.0) return finishRace(M, 'dq', 'Disqualified: the ROV skimmed the surface like a boat. Drag racers must stay under water.');
        const rivalDone = s.t >= T;
        if (rear < M.pool.finish) return finishRace(M, rivalDone ? 'lose' : 'win', null, s.t);
        if (s.t > T + 0.05 && !s.rivalFinished) { s.rivalFinished = true; M.event(`Rival finished in ${T.toFixed(2)} s`); }
        if (s.t > 60) finishRace(M, 'lose', 'Time limit (60 s).');
      },
      actions: [
        { key: 'Enter', label: 'Start race', show: M => M.state.phase === 'ready' || M.state.phase === 'done', run: M => startRace(M) }
      ],
      score(M) {
        const s = M.state;
        const rows = DRAG_ROUNDS.map((r, i) => ({ label: r.name, note: s.results && s.results[i] ? s.results[i] : (i === s.round ? 'up next' : '—') }));
        return { rows, total: null, race: true };
      }
    }
  };

  /* ---------- pilot training drills ---------- */
  function gateMesh(color) {
    const g = new THREE.Group(), m = World.mat('gate' + color, color, { roughness: 0.5 });
    const w = 0.45, top = -0.15, bot = -1.0;
    g.add(World.rod(V3(-w, top, 0), V3(-w, bot, 0), 0.02, m), World.rod(V3(w, top, 0), V3(w, bot, 0), 0.02, m));
    g.add(World.rod(V3(-w, top, 0), V3(w, top, 0), 0.02, m), World.rod(V3(-w, bot, 0), V3(w, bot, 0), 0.02, m));
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), World.mat('buoy', 0xff7a1a)); fl.position.y = 0.02; g.add(fl);
    return g;
  }
  function buoyMesh(n) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), World.mat('target', 0xff5a1f, { emissive: 0x401000 }));
    g.add(b);
    const s = World.textSprite(String(n), '#ffffff', 0.3); s.position.z = 0.135; g.add(s);
    const s2 = s.clone(); s2.rotation.y = Math.PI; s2.position.z = -0.135; g.add(s2);
    return g;
  }
  const grabTool = M => M.rov.tools.find(t => t.type === 'prong') || M.rov.tools.find(t => t.type === 'claw');
  function drill(o) {
    return Object.assign({ pool: 'comp', heatSec: 0, heats: 0, views: 'free', start: { x: 0, z: -0.6, y: -0.15, heading: 0 }, actions: [], score: () => null }, o);
  }
  const DRILLS = {
    drill1: drill({
      id: 'drill1', drill: 1, title: 'Drill 1: Gate slalom', short: 'Gates', stars: [35, 60],
      desc: 'Drive through the three gates in order: green is next. This drill teaches forward, turning and staying at the right depth.',
      setup(M) {
        const s = M.state;
        s.gates = [[0, -2.5], [-1.3, -5], [1.3, -7.5]].map(([x, z], i) => {
          const g = gateMesh(i ? 0xff7a1a : 0x22b455); g.position.set(x, 0, z); M.scene.add(g);
          const w = 0.45;
          M.env.obstacles.push({ a: V3(x - w, -0.15, z), b: V3(x - w, -1, z), r: 0.02 }, { a: V3(x + w, -0.15, z), b: V3(x + w, -1, z), r: 0.02 },
            { a: V3(x - w, -0.15, z), b: V3(x + w, -0.15, z), r: 0.02 }, { a: V3(x - w, -1, z), b: V3(x + w, -1, z), r: 0.02 });
          return { x, z, g };
        });
        s.next = 0; s.lastZ = M.start.z;
      },
      step(M) {
        const s = M.state, p = M.rov.p, G = s.gates[s.next];
        if (G && s.lastZ > G.z && p.z <= G.z) {
          if (Math.abs(p.x - G.x) < 0.42 && p.y < -0.2 && p.y > -0.95) {
            s.next++;
            G.g.traverse(o => { if (o.material && o.geometry.type === 'CylinderGeometry') o.material = World.mat('gateDone', 0x8a9aa0); });
            const N = s.gates[s.next];
            if (N) N.g.traverse(o => { if (o.material && o.geometry.type === 'CylinderGeometry') o.material = World.mat('gate' + 0x22b455, 0x22b455); });
            M.event(`Gate ${s.next} of 3!`, 'good'); M.sound && M.sound('ring');
            if (s.next >= 3) s.done = true;
          } else M.event('Missed the gate. Turn around and go through the middle.');
        }
        s.lastZ = p.z;
      },
      progress: M => `${M.state.next} of 3 gates`
    }),
    drill2: drill({
      id: 'drill2', drill: 2, title: 'Drill 2: Dive and hold', short: 'Depth', stars: [30, 50],
      desc: 'Follow the rope down to the orange ring, about 4 ft deep. Stay inside the ring’s depth zone for 5 seconds. This drill teaches diving and holding a steady depth.',
      setup(M) {
        const s = M.state, c = V3(0, -1.2, -6.5);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.025, 10, 48), World.mat('buoy', 0xff7a1a));
        ring.rotation.x = Math.PI / 2; ring.position.copy(c); M.scene.add(ring);
        M.scene.add(World.rod(V3(0.6, 0, -6.5), V3(0.6, -1.2, -6.5), 0.004, World.mat('line', 0x222222)));
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), World.mat('buoy', 0xff7a1a)); fl.position.set(0.6, 0.02, -6.5); M.scene.add(fl);
        s.c = c; s.hold = 0;
      },
      step(M, dt) {
        const s = M.state, p = M.rov.p;
        const inside = Math.hypot(p.x - s.c.x, p.z - s.c.z) < 0.7 && Math.abs(p.y - s.c.y) < 0.15;
        if (inside) { s.hold += dt; if (s.hold >= 5) s.done = true; }
        else if (s.hold > 0.3) { M.event('Drifted out of the zone. Hold steady!'); s.hold = 0; }
        else s.hold = 0;
        s.inside = inside;
      },
      progress: M => M.state.inside ? `Holding… ${M.state.hold.toFixed(1)} of 5 s` : `Depth now ${(-M.rov.p.y / 0.3048).toFixed(1)} ft · target 3.4–4.4 ft inside the ring`
    }),
    drill3: drill({
      id: 'drill3', drill: 3, title: 'Drill 3: Find it on camera', short: 'Camera', stars: [60, 100], views: 'cam', needs: 'camera',
      desc: 'Camera only, like a real heat. Find and bump the orange buoys in order, 1 to 3. Each one appears after you touch the last. Turn slowly and scan.',
      setup(M) {
        const s = M.state;
        const spots = [[2.5, -4], [-3, -6.5], [1.5, -9.5]].map(([x, z]) => [x + rand(-0.8, 0.8), z + rand(-0.8, 0.8)]);
        s.buoys = spots.map(([x, z], i) => { const g = buoyMesh(i + 1); g.position.set(x, -0.7, z); g.visible = i === 0; M.scene.add(g); return g; });
        s.next = 0;
      },
      step(M) {
        const s = M.state, b = s.buoys[s.next];
        if (b && M.rov.p.distanceTo(b.position) < 0.38) {
          b.visible = false; s.next++;
          if (s.buoys[s.next]) s.buoys[s.next].visible = true;
          M.event(`Buoy ${s.next} found!`, 'good'); M.sound && M.sound('ring');
          if (s.next >= 3) s.done = true;
        }
      },
      progress: M => `${M.state.next} of 3 buoys`
    }),
    drill4: drill({
      id: 'drill4', drill: 4, title: 'Drill 4: Pick up a ring', short: 'Pick up', stars: [30, 60], needs: 'grab',
      desc: 'A diving ring is on the floor ahead. Hook it with your prong (drive the tip through the hole) or grab it with the claw (G).',
      setup(M) { setupFlag(M, V3(3.5, 0, -6), { x0: -0.3, x1: 0.3, z0: -2.4, z1: -2.0 }, 1); },
      step(M, dt) { stepRings(M, dt); const r = M.state.rings[0]; if (r && (r.st === 'prong' || r.st === 'claw')) M.state.done = true; },
      progress: M => M.state.rings[0] && M.state.rings[0].st !== 'floor' ? 'Got it!' : 'Ring is on the floor ahead'
    }),
    drill5: drill({
      id: 'drill5', drill: 5, title: 'Drill 5: Hang it on the hook', short: 'Hang', stars: [40, 80], needs: 'grab',
      desc: 'Your ROV starts with a ring. Drive up to a J hook hanging under the tip-up, put the tool tip right on the hook, and press H (prong) or G to open the claw.',
      setup(M) { setupFlag(M, V3(0, 0, -3.2), { x0: 2, x1: 3, z0: -8, z1: -7 }, 1); },
      afterPlace(M) {
        const t = grabTool(M), r = M.state.rings[0]; if (!t || !r) return;
        if (t.type === 'prong') { r.st = 'prong'; r.tool = t; t.carried.push(r); }
        else { r.st = 'claw'; t.held = { kind: 'ring', ref: r }; t.closed = true; }
      },
      step(M, dt) { stepRings(M, dt); if (M.state.hooks.some(h => h.rings.length)) M.state.done = true; },
      progress: M => M.state.rings[0] && M.state.rings[0].st === 'floor' ? 'Dropped it: pick it up again' : 'Bring the ring to a hook'
    }),
    drill6: drill({
      id: 'drill6', drill: 6, title: 'Drill 6: Turn the spool', short: 'Spool', stars: [40, 80], needs: 'tool',
      desc: 'Find the black spool hanging under the tip-up. Push its shaft sideways with a tool (the spool fork works best) until it turns a quarter turn and the flag pops up.',
      setup(M) { setupFlag(M, V3(0, 0, -3.2), { x0: 0, x1: 0, z0: 0, z1: 0 }, 0); },
      step(M, dt) { stepRings(M, dt); if (M.state.flagUp) M.state.done = true; },
      progress: M => M.state.flagUp ? 'Flag up!' : M.state.spoolContact ? `Turning… ${Math.round(Math.abs(M.state.spoolAngle) * 180 / Math.PI)}° of 90°` : 'Find the spool under the tip-up'
    })
  };
  Object.assign(MISSIONS, DRILLS);

  const DRAG_ROUNDS = [{ name: 'Round 1', lo: 15.5, hi: 18 }, { name: 'Semifinal', lo: 12.5, hi: 14 }, { name: 'Final', lo: 10.2, hi: 11.4 }];

  function rearZ(M) {
    let mx = -Infinity;
    M.rov.els.forEach(e => { const w = Physics.worldOf(M.rov, e.rel); mx = Math.max(mx, w.z + e.r); });
    return mx;
  }
  function startRace(M) {
    const s = M.state;
    if (s.size && !s.size.ok) { M.event('This ROV is bigger than a 24" cube, so it cannot race. Make it smaller in Build.'); return; }
    if (s.round >= DRAG_ROUNDS.length) { s.round = 0; s.results = []; }
    const R = DRAG_ROUNDS[s.round];
    s.rivalT = rand(R.lo, R.hi); s.rivalFinished = false;
    s.phase = 'countdown'; s.cd = 3; s.ghost.position.z = -0.23;
    M.event(`${R.name}: on your marks… (3 s)`);
    M.sound && M.sound('beep');
  }
  function finishRace(M, res, why, t) {
    const s = M.state;
    s.phase = 'done';
    s.results = s.results || [];
    const R = DRAG_ROUNDS[s.round];
    const txt = res === 'win' ? `Won in ${t.toFixed(2)} s (rival ${s.rivalT.toFixed(2)} s)` : res === 'lose' ? (why || `Lost: ${t.toFixed(2)} s vs rival ${s.rivalT.toFixed(2)} s`) : 'DQ';
    s.results[s.round] = txt;
    s.best = s.best || {};
    if (res === 'win') {
      s.best.time = Math.min(s.best.time || 99, t);
      s.best.rounds = Math.max(s.best.rounds || 0, s.round + 1);
      M.event(`${R.name}: you win! ${t.toFixed(2)} s`, 'good'); M.sound && M.sound('flag');
      s.round++;
      if (s.round >= DRAG_ROUNDS.length) M.event('Drag race champion!', 'good');
    } else {
      M.event(res === 'dq' ? why : `${R.name}: ${txt}. Out of the bracket. Press Start race to try again from Round 1.`, res === 'dq' ? 'bad' : '');
      if (t) s.best.time = Math.min(s.best.time || 99, t);
      s.round = DRAG_ROUNDS.length;
    }
    M.onRaceDone && M.onRaceDone(res, t);
  }

  function penaltyRows(M) {
    const h = M.heat || { peeks: 0, divers: 0 };
    return [
      { label: 'Pilot peeking at pool', each: -20, count: h.peeks, pts: -20 * h.peeks },
      { label: 'Diver assistance', each: -20, count: h.divers, pts: -20 * h.divers }
    ];
  }

  function liveCounts(M) {
    const s = M.state;
    const rows = [];
    if (s.rings) {
      rows.push({ label: 'Rings on hooks', note: s.rings.filter(r => r.st === 'hook').length + ' / 10' });
      rows.push({ label: 'Rings handed to shore', note: String(s.rings.filter(r => r.st === 'shore').length) });
      rows.push({ label: 'Flag', note: s.flagUp ? 'up' : (s.spoolContact ? 'turning…' : 'down') });
    }
    if (s.sacs) rows.push({ label: 'Egg sacs released / delivered', note: s.sacs.filter(c => c.released).length + ' / ' + s.sacs.filter(c => c.delivered).length });
    if (s.hoopD) rows.push({ label: 'Hoop', note: 'measure it, then check in Challenge #1' });
    return { rows, total: null, practice: true };
  }

  function mapItems(M) {
    const s = M.state, items = [];
    if (s.rings) s.rings.forEach(r => r.st !== 'shore' && items.push({ t: 'ring', x: r.pos.x, z: r.pos.z, c: '#' + RING_COLORS[r.i % 4].toString(16).padStart(6, '0') }));
    if (s.tip) items.push({ t: 'tip', x: s.tip.position.x, z: s.tip.position.z });
    if (s.hoopAt) items.push({ t: 'hoop', x: s.hoopAt.x, z: s.hoopAt.z });
    if (s.reef) items.push({ t: 'reef', x: s.reef.position.x, z: s.reef.position.z });
    if (s.sacs) s.sacs.forEach(c => c.st !== 'shore' && c.st !== 'arm' && items.push({ t: 'sac', x: c.pos.x, z: c.pos.z, c: '#' + c.path.hex.toString(16).padStart(6, '0') }));
    if (s.ghost) items.push({ t: 'ghost', x: s.ghost.position.x, z: s.ghost.position.z });
    return items;
  }

  U.Missions = { MISSIONS, POOLS, DRILLS, DRAG_ROUNDS, toggleClaw, hangRing, handToTeammate, atStart, nearWallAtSurface, mapItems, rearZ };
})();
