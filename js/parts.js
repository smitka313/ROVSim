/* Parts catalog for the Underwater IVD ROV Lab.
   Units: mass in grams, volume (water displaced) in cm³, thrust in newtons, current in amps, price in US dollars.
   Prices are typical Amazon / hardware-store retail (parameter 2.3), rounded. Students should check real prices for their budget. */
(function () {
  const IN = 0.0254; // metres per inch

  // ½" schedule 40 PVC: OD 0.840", ID 0.622". Per inch of pipe:
  //   plastic volume 4.1 cm³ (≈ 6.0 g), air inside 4.98 cm³ when sealed.
  const PIPE = { gPerIn: 6.0, matCm3PerIn: 4.1, airCm3PerIn: 4.98, stickIn: 120, stickPrice: 4.48, od: 0.84 * IN };

  // Fittings are chosen automatically from how pipes meet at a joint.
  const FITTINGS = {
    cap:      { name: '½" end cap',                   price: 0.58, g: 8,  cm3: 6 },
    coupling: { name: '½" coupling',                  price: 0.48, g: 12, cm3: 9 },
    elbow:    { name: '½" 90° elbow',                 price: 0.62, g: 14, cm3: 10 },
    tee:      { name: '½" tee',                       price: 0.74, g: 18, cm3: 13 },
    corner3:  { name: '½" 3-way elbow (side outlet)', price: 1.98, g: 22, cm3: 16 },
    cross:    { name: '½" cross',                     price: 2.39, g: 24, cm3: 17 },
    side4:    { name: '½" 4-way tee (side outlet)',   price: 2.49, g: 26, cm3: 19 },
    way5:     { name: '½" 5-way cross',               price: 3.29, g: 30, cm3: 22 },
    way6:     { name: '½" 6-way cross',               price: 3.99, g: 34, cm3: 25 }
  };

  /* Placeable parts. kind decides how the part behaves:
     thruster: pushes along its direction; camera: gives a video feed; float/weight: trim;
     tool: has a working tip for the missions. size = [w,h,l] in metres for drawing and drag. */
  const PARTS = {
    // Motors: bilge pumps converted to thrusters (cut off the pump housing, add a prop)
    gph500:  { kind: 'thruster', cat: 'Motors', budget: 'Motors', name: '500 GPH bilge pump thruster', short: '500 GPH',
               price: 22.99, g: 230, cm3: 170, thrust: 4.0, rev: 0.6, amps: 2.6, size: [0.05, 0.05, 0.12],
               note: 'Light and cheap. About 4 N (0.9 lb) of thrust at 2.6 A.' },
    gph750:  { kind: 'thruster', cat: 'Motors', budget: 'Motors', name: '750 GPH bilge pump thruster', short: '750 GPH',
               price: 29.99, g: 280, cm3: 200, thrust: 6.0, rev: 0.6, amps: 3.6, size: [0.055, 0.055, 0.13],
               note: 'The middle choice. About 6 N (1.3 lb) at 3.6 A.' },
    gph1100: { kind: 'thruster', cat: 'Motors', budget: 'Motors', name: '1100 GPH bilge pump thruster', short: '1100 GPH',
               price: 37.99, g: 340, cm3: 240, thrust: 9.0, rev: 0.6, amps: 5.6, size: [0.06, 0.06, 0.14],
               note: 'Strong but thirsty. About 9 N (2 lb) at 5.6 A. Watch the 25 A fuse.' },
    // Cameras
    fishcam: { kind: 'camera', cat: 'Camera', budget: 'Camera & Monitor', name: 'Fishing camera + 7" monitor', short: 'Fishing cam',
               price: 89.99, g: 160, cm3: 120, fov: 85, size: [0.05, 0.05, 0.09],
               note: 'The standard UIVD camera. Wide view, shows depth and water temperature.' },
    fishcam2:{ kind: 'camera', cat: 'Camera', budget: 'Camera & Monitor', name: 'Second fishing camera (split monitor)', short: 'Camera 2',
               price: 64.99, g: 160, cm3: 120, fov: 85, size: [0.05, 0.05, 0.09],
               note: 'Point it down at your tool. Press C to switch cameras while piloting.' },
    // Buoyancy
    noodle3: { kind: 'float', cat: 'Buoyancy', budget: 'Material Stock', name: 'Pool noodle, 3" piece', short: 'Noodle 3"',
               price: 0.75, g: 6, cm3: 210, size: [0.065, 0.065, 0.076], note: 'Lifts about 200 g.' },
    noodle6: { kind: 'float', cat: 'Buoyancy', budget: 'Material Stock', name: 'Pool noodle, 6" piece', short: 'Noodle 6"',
               price: 1.25, g: 12, cm3: 420, size: [0.065, 0.065, 0.152], note: 'Lifts about 400 g.' },
    noodle12:{ kind: 'float', cat: 'Buoyancy', budget: 'Material Stock', name: 'Pool noodle, 12" piece', short: 'Noodle 12"',
               price: 2.25, g: 24, cm3: 840, size: [0.065, 0.065, 0.305], note: 'Lifts about 820 g.' },
    tubefloat:{kind: 'float', cat: 'Buoyancy', budget: 'PVC Tube & Fittings', name: 'Sealed 1½" PVC float tube, 8"', short: 'Float tube',
               price: 4.50, g: 190, cm3: 330, size: [0.048, 0.048, 0.2], note: 'Hard float with glued caps. Lifts about 140 g.' },
    // Ballast
    washer:  { kind: 'weight', cat: 'Ballast', budget: 'Misc Hardware', name: 'Steel fender washers (5-pack, 50 g)', short: 'Washers 50 g',
               price: 2.10, g: 50, cm3: 6.4, size: [0.04, 0.012, 0.04], note: 'Fine tuning. Sinks about 44 g each pack.' },
    sinker:  { kind: 'weight', cat: 'Ballast', budget: 'Misc Hardware', name: 'Coated dive weight, ½ lb', short: 'Weight ½ lb',
               price: 6.99, g: 227, cm3: 20, size: [0.06, 0.03, 0.05], note: 'Big trim changes. Sinks about 207 g.' },
    // Tools (attachments). tipLen = how far the working tip sticks out along the tool direction.
    prong6:  { kind: 'tool', tool: 'prong', cat: 'Tools', budget: 'PVC Tube & Fittings', name: 'Ring pick-up prong, 6"', short: 'Prong 6"',
               price: 1.80, g: 45, cm3: 32, tipLen: 0.16, cap: 3, size: [0.022, 0.022, 0.16],
               note: 'A ½" PVC finger with an upturned tip. Drive it straight through a standing ring to hook it. Carries 3 rings.' },
    prong12: { kind: 'tool', tool: 'prong', cat: 'Tools', budget: 'PVC Tube & Fittings', name: 'Ring pick-up prong, 12"', short: 'Prong 12"',
               price: 2.40, g: 85, cm3: 60, tipLen: 0.31, cap: 6, size: [0.022, 0.022, 0.31],
               note: 'Carries 6 rings, but sticks out further, so turning near the apparatus is harder.' },
    claw:    { kind: 'tool', tool: 'claw', cat: 'Tools', budget: 'Servos, Actuators & Other Components', name: 'Gripper claw with 12 V gear motor', short: 'Claw',
               price: 24.99, g: 210, cm3: 120, tipLen: 0.18, amps: 1.2, size: [0.07, 0.05, 0.18],
               note: 'Grabs one thing at a time: a ring, an egg sac ring or a floating sac. Press G to open or close.' },
    fork:    { kind: 'tool', tool: 'fork', cat: 'Tools', budget: 'PVC Tube & Fittings', name: 'Spool turner fork, 8"', short: 'Spool fork',
               price: 1.90, g: 55, cm3: 40, tipLen: 0.2, size: [0.07, 0.022, 0.2],
               note: 'A U-shaped PVC fork that catches the tip-up spool shaft so you can turn it and release the flag.' },
    ruler24: { kind: 'tool', tool: 'ruler', cat: 'Tools', budget: 'Material Stock', name: '24" aluminum ruler (cm marks)', short: 'Ruler 60 cm',
               price: 8.99, g: 120, cm3: 45, len: 0.61, size: [0.61, 0.004, 0.03],
               note: 'Mounted across the front, in view of the camera. Read the hoop’s inside edges off the scale.' },
    meter:   { kind: 'tool', tool: 'ruler', cat: 'Tools', budget: 'Material Stock', name: 'Meter stick (cm marks)', short: 'Meter stick',
               price: 5.49, g: 230, cm3: 260, len: 1.0, size: [1.0, 0.006, 0.028],
               note: 'Long enough for any hoop, but wide: it adds drag and catches on things.' }
  };

  const CATS = ['Motors', 'Camera', 'Buoyancy', 'Ballast', 'Tools'];

  // Topside and electrical choices. pass:false items fail the vehicle inspection (with the rule number).
  const ELECTRICAL = {
    battery: { label: 'Power source', rule: '6.1 / 6.2', options: {
      jumpbox:  { name: '12 V jump box (sealed lead acid, in its case)', price: 79.99, pass: true, volts: 12.6, rOhm: 0.03 },
      sla:      { name: '12 V 18 Ah gel battery in a battery box', price: 64.99, pass: true, volts: 12.8, rOhm: 0.02 },
      lithium:  { name: '18 V lithium drill battery', price: 59.99, pass: false, why: 'Rule 6.1: power must be a 12 V nominal lead acid battery.', volts: 18, rOhm: 0.02 },
      onboard:  { name: '12 V battery mounted on the ROV', price: 39.99, pass: false, why: 'Rule 6.6: batteries on the ROV itself are not allowed.', volts: 12.6, rOhm: 0.03 } } },
    connector: { label: 'Battery connection', rule: '6.8', options: {
      anderson: { name: 'Anderson style connectors (45 A)', price: 11.99, pass: true },
      plug:     { name: 'Vehicle accessory plug (fused)', price: 9.99, pass: true },
      clamp:    { name: 'Wires pinched in the jump box clamps', price: 0, pass: false, why: 'Rule 6.8.3: wires in the jump box clamps are not safe or reliable.' } } },
    fuse: { label: 'Inline fuse', rule: '6.9', options: {
      f15: { name: '15 A inline blade fuse', price: 7.99, pass: true, amps: 15 },
      f20: { name: '20 A inline blade fuse', price: 7.99, pass: true, amps: 20 },
      f25: { name: '25 A inline blade fuse', price: 7.99, pass: true, amps: 25 },
      f30: { name: '30 A inline blade fuse', price: 7.99, pass: false, why: 'Rule 6.9: the fuse can be 25 A at most.', amps: 30 },
      none:{ name: 'No fuse', price: 0, pass: false, why: 'Rule 6.9: a fuse is required. Teams cannot compete without it.', amps: 999 } } },
    fuseDist: { label: 'Fuse distance from the battery', rule: '6.9', options: {
      d15: { name: '15 cm (6") from the battery', price: 0, pass: true },
      d30: { name: '30 cm (12") from the battery', price: 0, pass: true },
      d60: { name: 'In the control box, 60 cm away', price: 0, pass: false, why: 'Rule 6.9: the fuse must be within 30 cm of the battery, before any other device.' } } },
    splice: { label: 'Wire connections', rule: '7.1 / 7.2', options: {
      crimp:  { name: 'Crimp connectors + heat shrink', price: 14.99, pass: true },
      solder: { name: 'Soldered + heat shrink', price: 12.99, pass: true },
      twist:  { name: 'Twisted together + electrical tape', price: 3.99, pass: false, why: 'Rule 7.1: twisted wires with tape or wire nuts are not allowed.' } } },
    gauge: { label: 'Motor and tether wire', rule: '7.6', options: {
      g12: { name: '12 AWG (thicker)', pass: true, ohmPerFt: 0.00159, perFt: 0.52 },
      g14: { name: '14 AWG (stock)', pass: true, ohmPerFt: 0.00253, perFt: 0.38 },
      g18: { name: '18 AWG (thinner, cheaper)', pass: false, why: 'Rule 7.6: wiring to a drive motor must be 14 gauge or larger (14 or lower number).', ohmPerFt: 0.00639, perFt: 0.18 } } },
    tether: { label: 'Tether length', rule: '', options: {
      t25: { name: '25 ft', pass: true, ft: 25 },
      t40: { name: '40 ft', pass: true, ft: 40 },
      t60: { name: '60 ft', pass: true, ft: 60 } } },
    tetherFloat: { label: 'Tether floats', rule: '', options: {
      yes: { name: 'Foam floats every 2 ft', price: 6.99, pass: true },
      no:  { name: 'No floats (tether hangs down)', price: 0, pass: true } } },
    display: { label: 'Camera monitor power', rule: '6.10', options: {
      batt:  { name: 'Monitor runs on its own battery or the 12 V box', price: 0, pass: true },
      wall:  { name: 'Monitor plugged into a wall outlet (110 V)', price: 0, pass: false, why: 'Rule 6.10: no 110 V AC devices in the pool area, including monitors and laptops on wall power.' } } },
    control: { label: 'Control box', rule: '', options: {
      switch: { name: 'DPDT toggle switches (full on / off / reverse)', pass: true, perMotor: 5.99, box: 14.99 },
      pwm:    { name: 'PWM speed controllers + joystick (variable speed)', pass: true, perMotor: 18.99, box: 34.99 } } }
  };

  const DEFAULT_ELECTRICAL = { battery: 'jumpbox', connector: 'anderson', fuse: 'f25', fuseDist: 'd15', splice: 'crimp', gauge: 'g14', tether: 't40', tetherFloat: 'yes', display: 'batt', control: 'switch' };

  const BUDGET_LINES = ['PVC Tube & Fittings', 'Motors', 'Batteries', 'Camera & Monitor', 'Wire, Switches & Connectors', 'Other Electronics',
    'Servos, Actuators & Other Components', 'Material Stock', 'Misc Hardware'];

  const DIRS = {
    fwd:   { v: [0, 0, -1], label: 'Forward' },
    back:  { v: [0, 0, 1],  label: 'Backward' },
    up:    { v: [0, 1, 0],  label: 'Up' },
    down:  { v: [0, -1, 0], label: 'Down' },
    left:  { v: [-1, 0, 0], label: 'Left' },
    right: { v: [1, 0, 0],  label: 'Right' }
  };

  window.UIVD = window.UIVD || {};
  Object.assign(window.UIVD, { IN, PIPE, FITTINGS, PARTS, CATS, ELECTRICAL, DEFAULT_ELECTRICAL, BUDGET_LINES, DIRS, BUILD_BUDGET: 2000 });
})();
