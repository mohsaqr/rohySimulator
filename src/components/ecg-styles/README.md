# Vendored copy of cardoyon's `styles/` — do not edit

Byte-identical copy of the upstream Cardoyon package's `styles/` folder
(`~/Documents/Github/ECG`), stamped in `.vendor.json` like every vendored
tree (RPS-1 §16). It is a separate entry from `src/components/ecg` because
upstream keeps the stylesheet outside `src/`.

- `package.css` — every selector scoped under the package's component roots
  (`:is(.ecg-screen, .ecg-author, .ecg-author-preview, .ecg-library-browser)`),
  so importing it cannot restyle the rest of rohy. Imported by the host
  adapter (`src/plugins/ecg/EcgRoom.jsx`).
- `standalone.css` — the upstream standalone app's globals. **Never import
  this in rohy**; it is here only because the vendor tool copies the folder
  whole, and the stamp must match upstream.

Edit upstream, `npm run verify` there, then `npm run vendor -- ecg-styles`.
