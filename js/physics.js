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
    const rTether = opt('gauge').ohmPerFt * (opt('tether').ft + 3) * 2;

    return {
      radius: Math.max(...els.map(e => e.rel.length() + e.r)) + 0.05,
      design, mp, M, Meff: M * 1.15 + RHO * mp.V * 1e-6 * 0.3, els, size, thrusters, cameras, tools, I, area, rotK, q,
      elec: { vBat: opt('battery').volts, r: rTether + opt('battery').rOhm, fuseA: opt('fuse').amps, pwm: E.control === 'pwm', amps: 0, volts: opt('battery').volts, heat: 0, blown: false, ah: 0 },
      tether: { len: opt('tether').ft * 0.3048, floats: E.tetherFloat === 'yes', pairs },
      p: V3(0, -0.5, -1), v: V3(0, 0, 0), qn: new THREE.Quaternion(), w: V3(0, 0, 0),
      cmd: { surge: 0, sway: 0, heave: 0, yaw: 0 }, contact: { floor: 0, surface: 0 }, t: 0
    };
  }

  function place(r, pos, headingDeg) {
    r.p.copy(pos); r.v.set(0, 0, 0); r.w.set(0, 0, 0);
    r.qn.setFromAxisAngle(V3(0, 1, 0), -(headingDeg || 0) * Math.PI / 180);
    r.tools.forEach(t => { t.carried = []; t.held = null; t.closed = false; });
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
      if (o.c.distanceTo(r.p) < o.h + r.radius) near.push(o);
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
      // apparatus (capsules)
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

    // Tether: weight (if no floats) and a hard stop at its full length
    if (env.anchor) {
      const dist = r.p.distanceTo(env.anchor);
      if (!r.tether.floats) addForce(V3(0, -0.05 * r.tether.pairs * Math.min(dist, r.tether.len) * Math.min(1, -r.p.y * 3 + 0.2), 0), r.p);
      if (dist > r.tether.len) {
        const pull = env.anchor.clone().sub(r.p).normalize().multiplyScalar(250 * (dist - r.tether.len));
        F.add(pull); r.tetherTight = true;
      } else r.tetherTight = false;
    }

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
  }

  function pointVel(r, wp) {
    const rel = wp.clone().sub(r.p);
    const ww = r.w.clone().applyQuaternion(r.qn);
    return new THREE.Vector3().crossVectors(ww, rel).add(r.v);
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

  U.Physics = { create, place, step, worldOf, telemetry, closestOnSeg, RHO, G };
})();
