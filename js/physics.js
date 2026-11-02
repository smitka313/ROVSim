/* Rigid-body ROV physics: buoyancy and weight per element, thrusters, drag, contact, tether and the electrical system. */
(function () {
  const U = window.UIVD;
  const { IN, PARTS, ELECTRICAL, DIRS, Design } = U;
  const RHO = 1000, G = 9.81;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  function create(design) {
    const mp = Design.massProps(design);
    const cm = V3(...mp.cm);
    const M = Math.max(0.2, mp.M / 1000);
    const els = mp.els.map(e => ({ rel: V3(...e.pos).sub(cm), m: e.g / 1000, v: e.cm3 * 1e-6, r: e.r, src: e.src, part: e.part }));
    const b = Design.bounds(design);
    const size = b.size.map(s => Math.max(0.08, s * IN));
    const E = design.elec, opt = k => ELECTRICAL[k].options[E[k]];

    const thrusters = [], cameras = [], tools = [];
    design.parts.forEach(p => {
      const P = PARTS[p.type]; if (!P) return;
      const at = V3(...p.at).multiplyScalar(IN).sub(cm);
      if (P.kind === 'thruster') thrusters.push({ id: p.id, P, pos: at, dir: V3(...DIRS[p.dir].v), out: 0, manual: 0 });
      if (P.kind === 'camera') cameras.push({ id: p.id, P, pos: at, tilt: (p.tilt || 0) * Math.PI / 180 });
      if (P.kind === 'tool') {
        const tip = V3(...Design.toolTip(p)).multiplyScalar(IN).sub(cm);
        tools.push({ id: p.id, P, type: P.tool, mount: at, tip, dir: V3(...DIRS[p.dir || 'fwd'].v), carried: [], closed: false, held: null });
      }
    });

    // Collision capsules for the frame pipes and tool shafts, so thin apparatus can't slip between the mass lumps
    const caps = design.pipes.map(p => ({ a: V3(...p.a).multiplyScalar(IN).sub(cm), b: V3(...p.b).multiplyScalar(IN).sub(cm), r: 0.0107 }));
    tools.forEach(t => caps.push({ a: t.mount.clone(), b: t.tip.clone(), r: 0.008 }));

    // Thruster allocation: how much each motor helps surge, sway, heave and yaw.
    const cols = ['surge', 'sway', 'heave', 'yaw'];
    thrusters.forEach(t => {
      const tq = new THREE.Vector3().crossVectors(t.pos, t.dir);
      t.alloc = { surge: -t.dir.z, sway: t.dir.x, heave: t.dir.y, yaw: -tq.y };
    });
    cols.forEach(c => {
      const mx = Math.max(1e-9, ...thrusters.map(t => Math.abs(t.alloc[c])));
      thrusters.forEach(t => { let a = t.alloc[c] / mx; if (Math.abs(a) < 0.2) a = 0; t.alloc[c] = a; });
    });

    // Inertia (diagonal), with extra for the water that moves with the ROV.
    const I = V3(0, 0, 0);
    els.forEach(e => { const r = e.rel; I.x += e.m * (r.y * r.y + r.z * r.z); I.y += e.m * (r.x * r.x + r.z * r.z); I.z += e.m * (r.x * r.x + r.y * r.y); });
    const addI = RHO * mp.V * 1e-6 * 0.25;
    I.x = I.x * 1.6 + addI * (size[1] ** 2 + size[2] ** 2) / 12 + 0.004;
    I.y = I.y * 1.6 + addI * (size[0] ** 2 + size[2] ** 2) / 12 + 0.004;
    I.z = I.z * 1.6 + addI * (size[0] ** 2 + size[1] ** 2) / 12 + 0.004;

    const fill = 0.5, Cd = 1.1, q = 0.5 * RHO * Cd * fill;
    const area = V3(size[1] * size[2], size[0] * size[2], size[0] * size[1]); // facing x, y, z motion
    const rotK = V3(
      q * size[0] * Math.hypot(size[1], size[2]) ** 4 / 32,
      q * size[1] * Math.hypot(size[0], size[2]) ** 4 / 32,
      q * size[2] * Math.hypot(size[0], size[1]) ** 4 / 32);
    // Long tools and meter sticks add drag
    design.parts.forEach(p => { const P = PARTS[p.type]; if (P && P.tool === 'ruler') { area.z += P.len * 0.03; rotK.y += q * 0.03 * P.len ** 4 / 32; } });

    const pairs = thrusters.length + tools.filter(t => t.type === 'claw').length;
    // the tether ties on at the back of the frame, halfway up
    let zMax = -Infinity, yLo = Infinity, yHi = -Infinity;
    design.pipes.forEach(p => [p.a, p.b].forEach(v => { zMax = Math.max(zMax, v[2]); yLo = Math.min(yLo, v[1]); yHi = Math.max(yHi, v[1]); }));
    const attach = design.pipes.length ? V3(0, (yLo + yHi) / 2, zMax).multiplyScalar(IN).sub(cm) : V3(0, 0, 0);
    const rTether = opt('gauge').ohmPerFt * (opt('tether').ft + 3) * 2;

    return {
      radius: Math.max(...els.map(e => e.rel.length() + e.r)) + 0.05,
      caps, extraCaps: [], design, mp, M, Meff: M * 1.15 + RHO * mp.V * 1e-6 * 0.3, els, size, thrusters, cameras, tools, I, area, rotK, q,
      elec: { vBat: opt('battery').volts, r: rTether + opt('battery').rOhm, fuseA: opt('fuse').amps, pwm: E.control === 'pwm', amps: 0, volts: opt('battery').volts, heat: 0, blown: false, ah: 0 },
      tether: { len: opt('tether').ft * 0.3048, floats: E.tetherFloat === 'yes', pairs, attach, mode: 'auto' }, rope: null,
      p: V3(0, -0.5, -1), v: V3(0, 0, 0), qn: new THREE.Quaternion(), w: V3(0, 0, 0),
      cmd: { surge: 0, sway: 0, heave: 0, yaw: 0 }, contact: { floor: 0, surface: 0, obst: 0, wall: 0 }, t: 0
    };
  }

  function place(r, pos, headingDeg) {
    r.p.copy(pos); r.v.set(0, 0, 0); r.w.set(0, 0, 0);
    r.qn.setFromAxisAngle(V3(0, 1, 0), -(headingDeg || 0) * Math.PI / 180);
    r.tools.forEach(t => { t.carried = []; t.held = null; t.closed = false; });
    r.extraCaps = []; r.rope = null;
    r.elec.heat = 0; r.elec.blown = false;
  }

  const tmp = V3(0, 0, 0), tmp2 = V3(0, 0, 0);
  function worldOf(r, rel, out) { return (out || V3(0, 0, 0)).copy(rel).applyQuaternion(r.qn).add(r.p); }

  function motorOutputs(r) {
    const c = r.cmd;
    r.thrusters.forEach(t => {
      let u = c.surge * t.alloc.surge + c.sway * t.alloc.sway + c.heave * t.alloc.heave + c.yaw * t.alloc.yaw;
      u += t.manual;
      if (r.elec.pwm) u = Math.max(-1, Math.min(1, u));
      else u = Math.abs(u) > 0.35 ? Math.sign(u) : 0;
      t.out = r.elec.blown ? 0 : u;
    });
  }

  /* env: { floorY(x,z), walls:{x0,x1,z0,z1}, obstacles:[{a,b,r}], anchor: Vector3 } */
  function step(r, dt, env) {
    motorOutputs(r);
    const F = V3(0, 0, 0), T = V3(0, 0, 0);
    const addForce = (f, worldPt) => { F.add(f); tmp2.copy(worldPt).sub(r.p); T.add(new THREE.Vector3().crossVectors(tmp2, f)); };

    // Electrical: current draw and voltage at the motors (battery + tether resistance)
    let I = 0;
    r.thrusters.forEach(t => { const a = Math.abs(t.out); I += t.P.amps * (r.elec.pwm ? Math.pow(a, 1.4) : a); });
    r.tools.forEach(t => { if (t.type === 'claw' && t.moving > 0) { I += t.P.amps; t.moving -= dt; } });
    const vMotor = Math.max(0, r.elec.vBat - I * r.elec.r);
    I = I * Math.min(1, vMotor / 12); // motors draw a little less on a sagging supply
    r.elec.amps = I; r.elec.volts = vMotor;
    r.elec.ah += I * dt / 3600;
    if (!r.elec.blown) {
      if (I > r.elec.fuseA) r.elec.heat += dt * ((I / r.elec.fuseA) ** 2 - 1) * 0.8;
      else r.elec.heat = Math.max(0, r.elec.heat - dt * 0.3);
      if (r.elec.heat > 1) { r.elec.blown = true; r.onFuse && r.onFuse(); }
    }
    const vf = Math.min(1.15, (vMotor / 12) ** 2);

    // Buoyancy and weight, element by element (this gives the righting moment and surface floating)
    r.contact.floor = 0; r.contact.surface = 0; r.contact.obst = 0; r.contact.wall = 0;
    let wetFrac = 0, totalV = 0;
    // only test apparatus that is near the ROV
    const near = [];
    for (const o of env.obstacles) {
      if (!o.c) { o.c = o.a.clone().add(o.b).multiplyScalar(0.5); o.h = o.a.distanceTo(o.b) / 2 + o.r; }
      if (o.c.distanceTo(r.p) < o.h + r.radius + (r.extraCaps.length ? 0.15 : 0)) near.push(o);
    }
    for (const e of r.els) {
      const wp = worldOf(r, e.rel, tmp);
      const s = Math.max(0, Math.min(1, (0 - (wp.y - e.r)) / (2 * e.r)));
      if (e.v > 0) { wetFrac += s * e.v; totalV += e.v; }
      if (s < 1 && e.src !== 'tip') r.contact.surface = 1;
      const fy = (RHO * e.v * s - e.m) * G;
      if (fy !== 0) addForce(V3(0, fy, 0), wp);
      // floor contact
      const fl = env.floorY(wp.x, wp.z);
      const pen = fl - (wp.y - e.r);
      if (pen > 0) {
        r.contact.floor = 1;
        const vp = pointVel(r, wp);
        const n = Math.min(400 * pen - 25 * Math.min(0, vp.y), 60);
        const fr = V3(-vp.x, 0, -vp.z); const fl2 = fr.length();
        if (fl2 > 1e-4) fr.multiplyScalar(Math.min(0.6 * n, fl2 * 30) / fl2);
        addForce(V3(fr.x, Math.max(0, n), fr.z), wp);
      }
      // walls
      const W = env.walls;
      const wallPush = (penW, nx, nz) => {
        if (penW <= 0) return;
        r.contact.wall = 1;
        const vp = pointVel(r, wp);
        const vn = vp.x * nx + vp.z * nz;
        const n = Math.max(0, 400 * penW - 25 * Math.min(0, vn));
        addForce(V3(nx * n - vp.x * 4 * (1 - Math.abs(nx)), -vp.y * 4, nz * n - vp.z * 4 * (1 - Math.abs(nz))), wp);
      };
      wallPush(W.x0 - (wp.x - e.r), 1, 0); wallPush((wp.x + e.r) - W.x1, -1, 0);
      wallPush(W.z0 - (wp.z - e.r), 0, 1); wallPush((wp.z + e.r) - W.z1, 0, -1);
      // apparatus (capsules); pipes and tool tips are handled as capsules below
      if (e.src === 'pipe' || e.src === 'tip') continue;
      for (const o of near) {
        const c = closestOnSeg(wp, o.a, o.b);
        const d = wp.distanceTo(c), pen2 = o.r + e.r - d;
        if (pen2 > 0 && d > 1e-6) {
          const nrm = wp.clone().sub(c).divideScalar(d);
          const vp = pointVel(r, wp);
          const vn = vp.dot(nrm);
          addForce(nrm.multiplyScalar(Math.max(0, 300 * pen2 - 20 * Math.min(0, vn))), wp);
          o.hit = (o.hit || 0) + dt; r.contact.obst = 1;
        }
      }
    }
    const wet = totalV ? wetFrac / totalV : 1;

    // Pipes, tool shafts and carried rings against the apparatus: capsule against capsule, with a little bounce
    if (near.length) {
      const ca = V3(0, 0, 0), cb = V3(0, 0, 0);
      const hitCap = cp => {
        worldOf(r, cp.a, ca); worldOf(r, cp.b, cb);
        for (const o of near) {
          const [pr, po] = closestSegSeg(ca, cb, o.a, o.b);
          const d = pr.distanceTo(po), pen = o.r + cp.r - d;
          if (pen <= 0) continue;
          let nrm = pr.clone().sub(po);
          if (d < 1e-4) {
            // dead-centre crossing: push away from the apparatus axis toward the ROV's middle
            const ax = o.b.clone().sub(o.a).normalize();
            nrm = r.p.clone().sub(closestOnSeg(r.p, o.a, o.b)); nrm.addScaledVector(ax, -nrm.dot(ax));
            if (nrm.lengthSq() < 1e-10) nrm.set(0, 1, 0);
          }
          nrm.normalize();
          const vp = pointVel(r, pr), vn = vp.dot(nrm);
          const n = Math.min(2500 * pen - 20 * Math.min(0, vn), 100);
          const tang = vp.clone().addScaledVector(nrm, -vn).multiplyScalar(-3); // a little rub along the pipe
          addForce(nrm.multiplyScalar(n).add(tang), pr);
          o.hit = (o.hit || 0) + dt; r.contact.obst = 1;
        }
      };
      r.caps.forEach(hitCap); r.extraCaps.forEach(hitCap);
    }

    // Thrusters (only push when their prop is underwater)
    for (const t of r.thrusters) {
      if (!t.out) continue;
      const wp = worldOf(r, t.pos, V3(0, 0, 0));
      const sub = wp.y < -0.02 ? 1 : 0.1;
      const mag = t.P.thrust * (t.out > 0 ? t.out : t.out * t.P.rev) * vf * sub;
      const d = t.dir.clone().applyQuaternion(r.qn).multiplyScalar(mag);
      addForce(d, wp);
    }

    // Extra forces from the mission (a buoyant egg sac in the claw, for example)
    if (env.ext) env.ext.forEach(x => addForce(x.f, x.p));

    // Tether: the rope pulls on the back of the ROV (worked out by stepRope at the end of the last step)
    if (env.anchor && r.rope) addForce(r.rope.force, worldOf(r, r.tether.attach, V3(0, 0, 0)));

    // Drag in the body frame
    const qi = r.qn.clone().invert();
    const vb = r.v.clone().applyQuaternion(qi);
    const dragB = V3(
      -(r.q * r.area.x * Math.abs(vb.x) * vb.x + 2.5 * vb.x),
      -(r.q * r.area.y * Math.abs(vb.y) * vb.y + 2.5 * vb.y),
      -(r.q * r.area.z * Math.abs(vb.z) * vb.z + 2.5 * vb.z)).multiplyScalar(0.25 + 0.75 * wet);
    F.add(dragB.applyQuaternion(r.qn));

    // Integrate translation
    r.v.addScaledVector(F, dt / r.Meff);
    r.p.addScaledVector(r.v, dt);

    // Rotation: body-frame torque, inertia and rotational drag
    const Tb = T.applyQuaternion(qi);
    const w = r.w;
    Tb.x -= (r.rotK.x * Math.abs(w.x) + 0.25) * w.x;
    Tb.y -= (r.rotK.y * Math.abs(w.y) + 0.25) * w.y;
    Tb.z -= (r.rotK.z * Math.abs(w.z) + 0.25) * w.z;
    w.x += Tb.x / r.I.x * dt; w.y += Tb.y / r.I.y * dt; w.z += Tb.z / r.I.z * dt;
    const lim = 6; w.clampScalar(-lim, lim);
    const ang = w.length() * dt;
    if (ang > 1e-9) {
      const dq = new THREE.Quaternion().setFromAxisAngle(w.clone().normalize(), ang);
      r.qn.multiply(dq).normalize();
    }
    r.t += dt;
    if (env.anchor) stepRope(r, env, dt);
  }

  /* ---------- the tether: a rope of ROPE_N links from the deck to the back of the ROV ----------
     Position-based (XPBD) links that can only pull. Each link's stretch gives the tension, and the last
     link's tension is the force on the ROV. The rope sinks or floats, drags in the water, lies on the
     floor, and grips the apparatus it touches, so it can snag. */
  const ROPE_N = 30;
  function ropeInit(r, env) {
    const A = env.anchor.clone(), B = worldOf(r, r.tether.attach, V3(0, 0, 0)), len = r.tether.len;
    const L = r.tether.mode === 'loose' ? len : Math.min(len, Math.max(1, A.distanceTo(B) * 1.12 + 0.8));
    const x = [], xp = [];
    for (let i = 0; i <= ROPE_N; i++) { const p = A.clone().lerp(B, i / ROPE_N); x.push(p); xp.push(p.clone()); }
    // per metre of tether: mass in air, and weight in water (a 14 AWG pair sinks about 17 g/m; foam floats every 2 ft lift it)
    const pairs = Math.max(1, r.tether.pairs), floats = r.tether.floats;
    r.rope = { x, xp, n: new Array(ROPE_N + 1).fill(null), hit: new Array(ROPE_N + 1).fill(null), L, kgm: 0.045 * pairs + (floats ? 0.03 : 0), netKgm: floats ? -0.025 : 0.017 * pairs,
      lam: new Float64Array(ROPE_N), force: V3(0, 0, 0), tension: 0, cmd: 0, snag: null, snagT: 0, freeT: 0 };
  }
  function stepRope(r, env, dt) {
    const B = worldOf(r, r.tether.attach, V3(0, 0, 0));
    if (!r.rope || r.rope.x[ROPE_N].distanceTo(B) > 0.3) ropeInit(r, env); // a fresh start, or the ROV was moved by hand
    const R = r.rope, N = ROPE_N, x = R.x, xp = R.xp, len = r.tether.len;
    const A = env.anchor;
    // the tender on deck decides how much tether is out
    const mode = r.tether.mode;
    if (mode === 'loose') R.L = len;
    else if (mode === 'manual') R.L += R.cmd * 0.6 * dt;
    else if (R.tension > 3) R.L += 1.2 * dt; // feel a pull, let more out
    else {
      // keep a little slack, and feed ahead of an ROV that is heading away
      const away = Math.max(0, r.v.dot(B.clone().sub(A).normalize()));
      const want = A.distanceTo(B) * 1.12 + 0.8 + away * 1.5;
      R.L += Math.max(-0.5 * dt, Math.min(2 * dt, want - R.L));
    }
    R.L = Math.max(1, Math.min(len, R.L));
    const seg = R.L / N;
    x[0].copy(A); xp[0].copy(A); x[N].copy(B); xp[N].copy(B);
    // move each node: weight or lift, and water drag
    const ay = -9.81 * R.netKgm / (R.kgm * 2), keepW = Math.exp(-6 * dt), keepA = Math.exp(-0.5 * dt);
    for (let i = 1; i < N; i++) {
      const p = x[i], q = xp[i], wet = p.y < 0, k = wet ? keepW : keepA;
      const vx = (p.x - q.x) * k, vy = (p.y - q.y) * k, vz = (p.z - q.z) * k;
      q.copy(p);
      p.x += vx; p.y += vy + (wet ? ay : -9.81) * dt * dt; p.z += vz;
    }
    // apparatus near the rope
    let lo = V3(Infinity, Infinity, Infinity), hi = V3(-Infinity, -Infinity, -Infinity);
    x.forEach(p => { lo.min(p); hi.max(p); });
    const near = env.obstacles.filter(o => {
      if (!o.c) { o.c = o.a.clone().add(o.b).multiplyScalar(0.5); o.h = o.a.distanceTo(o.b) / 2 + o.r; }
      return o.c.x + o.h > lo.x && o.c.x - o.h < hi.x && o.c.y + o.h > lo.y && o.c.y - o.h < hi.y && o.c.z + o.h > lo.z && o.c.z - o.h < hi.z;
    });
    const W = env.walls, wInv = 1 / (R.kgm * seg), at = 1 / (400 * N) / (dt * dt), lam = R.lam;
    lam.fill(0); R.hit.fill(null);
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < N; i++) {
        const a = x[i], b = x[i + 1], wa = i === 0 ? 0 : wInv, wb = i + 1 === N ? 0 : wInv;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
        if (d < 1e-9) continue;
        let dl = (-(d - seg) - at * lam[i]) / (wa + wb + at);
        if (lam[i] + dl > 0) dl = -lam[i]; // a rope can only pull
        lam[i] += dl;
        const s = dl / d;
        a.x -= wa * dx * s; a.y -= wa * dy * s; a.z -= wa * dz * s;
        b.x += wb * dx * s; b.y += wb * dy * s; b.z += wb * dz * s;
      }
      for (let i = 1; i < N; i++) {
        const p = x[i];
        const fl = env.floorY(p.x, p.z) + 0.005;
        if (p.y < fl) { p.y = fl; R.hit[i] = R.hit[i] || 'floor'; }
        if (p.y < 0) { p.x = Math.max(W.x0 + 0.01, Math.min(W.x1 - 0.01, p.x)); p.z = Math.max(W.z0 + 0.01, Math.min(W.z1 - 0.01, p.z)); }
        for (const o of near) {
          const abx = o.b.x - o.a.x, aby = o.b.y - o.a.y, abz = o.b.z - o.a.z, L2 = abx * abx + aby * aby + abz * abz;
          const t = L2 ? Math.max(0, Math.min(1, ((p.x - o.a.x) * abx + (p.y - o.a.y) * aby + (p.z - o.a.z) * abz) / L2)) : 0;
          const cx = o.a.x + abx * t, cy = o.a.y + aby * t, cz = o.a.z + abz * t;
          let nx = p.x - cx, ny = p.y - cy, nz = p.z - cz; const dd = Math.hypot(nx, ny, nz), rr = o.r + 0.006;
          if (dd >= rr) continue;
          if (dd < 1e-6) { nx = 0; ny = 1; nz = 0; } else { nx /= dd; ny /= dd; nz /= dd; }
          p.x = cx + nx * rr; p.y = cy + ny * rr; p.z = cz + nz * rr;
          R.hit[i] = o; R.n[i] = V3(nx, ny, nz);
        }
      }
    }
    // friction: rope on the floor drags, rope on the apparatus grips
    for (let i = 1; i < N; i++) {
      const h = R.hit[i]; if (!h) continue;
      const p = x[i], q = xp[i], dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
      if (h === 'floor') { p.x -= dx * 0.6; p.z -= dz * 0.6; continue; }
      const n = R.n[i], dn = dx * n.x + dy * n.y + dz * n.z;
      p.x -= (dx - n.x * dn) * 0.9; p.y -= (dy - n.y * dn) * 0.9; p.z -= (dz - n.z * dn) * 0.9;
    }
    // the last link's pull is the force on the ROV
    const a = x[N - 1], dxl = a.x - B.x, dyl = a.y - B.y, dzl = a.z - B.z, dl = Math.hypot(dxl, dyl, dzl) || 1;
    let T = Math.min(80, -lam[N - 1] / (dt * dt));
    if (T > 3) {
      // a taut tether barely stretches: damp the ROV moving away along it, so it doesn't bounce like a bungee
      const v = pointVel(r, B), away = -(v.x * dxl + v.y * dyl + v.z * dzl) / dl;
      if (away > 0) T = Math.min(80, T + 40 * away);
    }
    R.tension = T; R.force.set(dxl / dl * T, dyl / dl * T, dzl / dl * T);
    r.tetherTight = T > 6;
    // snagged: pulling hard while the rope is caught on the apparatus
    const caught = R.hit.find(h => h && h !== 'floor');
    if (caught && T > 4) { R.snagT += dt; R.freeT = 0; if (R.snagT > 0.8) R.snag = caught.name || 'the apparatus'; }
    else { R.freeT += dt; if (R.freeT > 0.6) { R.snagT = 0; R.snag = null; } }
  }

  // A diver lifts the tether off the apparatus
  function freeRope(r) {
    const R = r.rope; if (!R) return false;
    let n = 0;
    for (let i = 1; i < ROPE_N; i++) { const h = R.hit[i]; if (h && h !== 'floor') { R.x[i].y += 0.25; R.xp[i].copy(R.x[i]); n++; } }
    R.snag = null; R.snagT = 0;
    return n > 0;
  }

  function pointVel(r, wp) {
    const rel = wp.clone().sub(r.p);
    const ww = r.w.clone().applyQuaternion(r.qn);
    return new THREE.Vector3().crossVectors(ww, rel).add(r.v);
  }

  // Closest points between segments p1-q1 and p2-q2
  function closestSegSeg(p1, q1, p2, q2) {
    const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), rr = p1.clone().sub(p2);
    const a = d1.lengthSq(), e = d2.lengthSq(), f = d2.dot(rr);
    let s = 0, t = 0;
    if (a < 1e-12 && e < 1e-12) return [p1.clone(), p2.clone()];
    if (a < 1e-12) t = Math.max(0, Math.min(1, f / e));
    else {
      const c = d1.dot(rr);
      if (e < 1e-12) s = Math.max(0, Math.min(1, -c / a));
      else {
        const b = d1.dot(d2), den = a * e - b * b;
        s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
        else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
      }
    }
    return [p1.clone().addScaledVector(d1, s), p2.clone().addScaledVector(d2, t)];
  }

  function closestOnSeg(p, a, b) {
    const ab = tmp.copy(b).sub(a);
    const L2 = ab.lengthSq();
    const t = L2 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / L2)) : 0;
    return a.clone().addScaledVector(ab, t);
  }

  function telemetry(r) {
    const e = new THREE.Euler().setFromQuaternion(r.qn, 'YXZ');
    let hdg = (-e.y * 180 / Math.PI) % 360; if (hdg < 0) hdg += 360;
    const fwd = V3(0, 0, -1).applyQuaternion(r.qn);
    return {
      depth: Math.max(0, -r.p.y), heading: hdg, pitch: e.x * 180 / Math.PI, roll: -e.z * 180 / Math.PI,
      speed: r.v.length(), fwdSpeed: r.v.dot(fwd), vy: r.v.y,
      amps: r.elec.amps, volts: r.elec.volts, blown: r.elec.blown, heat: r.elec.heat
    };
  }

  U.Physics = { create, place, step, worldOf, telemetry, closestOnSeg, closestSegSeg, freeRope, ROPE_N, RHO, G };
})();
