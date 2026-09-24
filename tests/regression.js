// Test regresyjny rdzenia na zdjęciach z pola.
// Użycie: npm i jpeg-js && node tests/regression.js <folder_ze_zdjęciami> [zdjęcie_kalibracyjne]
const fs = require('fs'), path = require('path'), jpeg = require('jpeg-js'), C = require('../src/core.js');
const dir = process.argv[2] || '..', calib = process.argv[3];
const rect = [606, 718], D = 800;
const files = fs.readdirSync(dir).filter(f => /\.jpe?g$/i.test(f)).sort();
function load(f) {
  const im = jpeg.decode(fs.readFileSync(path.join(dir, f)), { useTArray: true }), { width: w, height: h, data } = im;
  const a = C.assignCorners(C.detectMarkers(C.toGray(data, w, h), w, h));
  if (!a.ok) return { a };
  return { a, data, w, h, H: C.homography([[0, 0], [rect[0], 0], rect, [0, rect[1]]], a.pts), L: C.makeLUT(C.colorRef(data, w, h, a.markers)) };
}
const c0 = load(calib || files[0]);
const P = C.calibrateFace(c0.data, c0.w, c0.h, c0.H, rect, D, c0.L);
if (!P.ok) { console.log('Kalibracja nieudana:', P.msg); process.exit(1); }
console.log(`Profil: środek ${P.c.map(v => v.toFixed(1)).join(' / ')} mm, skala ${P.s.toFixed(4)}, owalność ${P.ovality.toFixed(3)}`);
let n = 0, g = 0;
for (const f of files) {
  const x = load(f); n++;
  if (!x.H) { console.log(f, '—', x.a.msg); continue; }
  const v = C.verifyProfile(x.data, x.w, x.h, x.H, rect, D, x.L, P);
  if (v.state === 'green') g++;
  console.log(f.padEnd(40), v.state.padEnd(6), v.dev != null ? v.dev.toFixed(1) + ' mm' : '');
}
console.log(`Zielone: ${g}/${n}`);
