# Vendored copy of `cardoyon` — do not edit

This folder is a byte-identical copy of the `src/` of the upstream Cardoyon
package (`~/Documents/Github/ECG`, github: the user's Cardoyon repo), the
12-lead ECG case library and reading workstation. Provenance is recorded in
`.vendor.json`, and `tests/server/vendored-packages.test.js` fails if this
folder drifts from its stamp.

- **Never edit here.** Edit upstream, run `npm run verify` there, then
  `npm run vendor -- ecg` here (RPS-1 §16).
- Host adapter: `src/plugins/ecg/` (`manifest.js`, `index.jsx`, `EcgRoom.jsx`).
- The only host-owned files in this folder are this README and
  `portability.test.js` — the gate that keeps the copy a *package*
  (props in, nothing imported from rohy).
- The package stylesheet ships separately: vendored at
  `src/components/ecg-styles/` (its own stamped entry, `ecg-styles`).
