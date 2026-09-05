# Vendored copy of `cardoyon` — do not edit

This folder is a byte-identical copy of the `src/` of the upstream Cardoyon
package (`~/Documents/Github/ECG`, github: the user's Cardoyon repo), the
12-lead ECG case library and reading workstation. Provenance is recorded in
`.vendor.json`, and `tests/server/vendored-packages.test.js` fails if this
folder drifts from its stamp.

- **Never edit here.** Edit upstream, run `npm run verify` there, then
  `npm run vendor -- ecg` here (RPS-1 §16).
- Host adapter: `src/plugins/ecg/` (`manifest.js`, `index.jsx`, `EcgRoom.jsx`).
  The adapter hands the room `event_logger: { log: ctx.log }` (RPS-1 1.6);
  `create_ecg_logger` wraps it. Three verbs are declared `planned` (no submit
  button by design; hints/explanations not yet shown) — `npm run
  plugins:emissions` prints them.
- The only host-owned files in this folder are this README and
  `portability.test.js` — the gate that keeps the copy a *package*
  (props in, nothing imported from rohy).
- The package stylesheet ships separately: vendored at
  `src/components/ecg-styles/` (its own stamped entry, `ecg-styles`).
