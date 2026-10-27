# ROVSim: Underwater IVD ROV Lab

A browser-based simulator for the Square One **Underwater Innovative Vehicle Design (UIVD) 2026–27** competition. Students design a virtual ROV from ½" PVC, bilge-pump thrusters, a fishing camera, floats, ballast and tools, then pilot it through the four competition challenges.

## Features

- **Guided build in 7 steps:** Frame → Motors → Camera → Tools → Trim → Power → Check
  - Box-frame sliders or hand editing in 3D (click a joint, then an arrow)
  - Click-to-place parts that snap onto pipes; drag to move them
  - Quick motor layouts with thrust arrows on the model
  - Live camera preview, buoyancy meter, balance view and auto-trim helper
  - Power and wiring choices checked against the 2027 inspection form
  - Bill of materials and $2,000 budget, exportable as CSV
- **Pilot mode:** test tank, practice pool, and all four challenges scored from the parameters
  - #1 Hula Hoop Hustle, #2 Raising the "All Clear" Flag, #3 "Carp" Diem, #4 Drag Race
  - Pilot sees only the ROV camera during heats; peeking and diver assists cost −20
  - Fuse, tether voltage drop, keyboard / gamepad / touch controls, data logging
- **Pilot training:** six short drills (gates, depth hold, camera-only search, pick up, hang, spool) with 1–3 stars, unlocking in order
- **Heat replay:** every heat records the ROV's path and events; replay it on the pool map with a timeline, depth graph and stats
- **Design log:** each test saves a snapshot of the design and its result, with automatic change summaries, side-by-side comparison, student notes and a printable journal page
- **Shop sheet:** printable drawings, cut list, part placement, wiring diagram, shopping list and inspection checklist for building the real ROV
- **Junior mode (grades 3–6):** simpler steps and wording, no wiring step, and the fuse can't blow
- **Turn-in and teacher view:** students save one file; the teacher view ranks the class with time bonuses and normalized scores out of 300

## Running it

Serve the folder with any static web server, then open `index.html`:

```
python3 -m http.server 8000
# visit http://localhost:8000
```

It also works on GitHub Pages (Settings → Pages → deploy from the `main` branch).

## Files

- `index.html`: page layout and styles
- `js/parts.js`: parts catalog, prices and electrical options
- `js/design.js`: ROV design model, fittings, mass properties, budget, inspection
- `js/physics.js`: rigid-body physics (buoyancy, thrust, drag, tether, fuse)
- `js/world.js`: 3D models of the ROV, pool and apparatus
- `js/missions.js`: the challenges, pilot drills and their scoring
- `js/extras.js`: design log, shop sheet and heat replay
- `js/app.js`: interface, builder, piloting, heats, turn-in and teacher view
- `vendor/three.min.js`: three.js r128 (MIT license)

The physics are simplified and part prices are typical estimates. Test real ROVs and check real prices before submitting a budget.
