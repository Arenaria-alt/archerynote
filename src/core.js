/* ArcheryNote core — marker detection, homography, face calibration, scoring.
   Zero dependencies. Works in browser (window.ANCore) and Node (module.exports).
   ARENARIA & Claude (Anthropic) */
(function (root) {
'use strict';

// ---------- ArUco DICT_4X4_50, IDs 0–47 (row-major, 1 = white); target k uses IDs 4k..4k+3 ----------
const CODES = [
  '1011010100110010',
  '0000111110011010',
  '0011001100101101',
  '1001100101000110',
  '0101010010011110',
  '0111100111001101',
  '1001111000101110',
  '1100010011110010',
  '1111111011011010',
  '1100111101010110',
  '1111100110010001',
  '0001000110100111',
  '0000111010110111',
  '0010101000001111',
  '0010010010110001',
  '0010011000111110',
  '0100011001100101',
  '0110011000000000',
  '0110110001011110',
  '0111011010101111',
  '1000011010001011',
  '1011000000101011',
  '1100110011010101',
  '1101110110000010',
  '1111111001000111',
  '1001010001110001',
  '1010110011100100',
  '1010010101010100',
  '0010000100100011',
  '0011010001101111',
  '0100010000010101',
  '0101011110110010',
  '1001111011001111',
  '1111000011001011',
  '0000100010101110',
  '0000100100101001',
  '0001100001110101',
  '0000010011111111',
  '0000110111110110',
  '0001110001011010',
  '0001011100011000',
  '0010101000101000',
  '0011001010001100',
  '0011100010110010',
  '0010010011101000',
  '0010111011101011',
  '0010110100111111',
  '0100101101100100'
].map(s => s.split('').map(Number));
const NSETS = 12;

function rot90(b) { // rotate 4x4 clockwise
  const r = new Array(16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) r[x * 4 + (3 - y)] = b[y * 4 + x];
  return r;
}
const CODE_ROTS = CODES.map(c => { const a = [c]; for (let i = 0; i < 3; i++) a.push(rot90(a[i])); return a; });

// ---------- image helpers ----------
function toGray(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return g;
}
function integral(g, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) { s += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; }
  }
  return I;
}
function adaptive(g, w, h, I, win, C) {
  const out = new Uint8Array(w * h), r = win >> 1, W1 = w + 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
      const m = s / ((y1 - y0) * (x1 - x0));
      out[y * w + x] = g[y * w + x] < m - C ? 1 : 0;
    }
  }
  return out;
}
function bilinear(g, w, h, x, y) {
  if (x < 0 || y < 0 || x > w - 1.001 || y > h - 1.001) return -1;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
}

// ---------- connected components (4-conn, union-find) ----------
function components(bin, w, h) {
  const lab = new Int32Array(w * h), par = [0];
  const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!bin[i]) continue;
    const up = y ? lab[i - w] : 0, lf = x ? lab[i - 1] : 0;
    if (!up && !lf) { lab[i] = ++n; par.push(n); }
    else if (up && lf) { const a = find(up), b = find(lf); lab[i] = Math.min(a, b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
    else lab[i] = up || lf;
  }
  const st = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!lab[i]) continue;
    const l = find(lab[i]); lab[i] = l;
    let s = st.get(l);
    if (!s) { s = { l, n: 0, x0: x, x1: x, y0: y, y1: y }; st.set(l, s); }
    s.n++; if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x; if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
  }
  return { lab, stats: [...st.values()] };
}

function hull(pts) { // monotone chain, pts [[x,y]]
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
const polyArea = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

function quadFromHull(H) {
  if (H.length < 4) return null;
  let best = 0, ia = 0, ic = 0;
  for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) {
    const d = (H[i][0] - H[j][0]) ** 2 + (H[i][1] - H[j][1]) ** 2; if (d > best) { best = d; ia = i; ic = j; }
  }
  const A = H[ia], C = H[ic], dx = C[0] - A[0], dy = C[1] - A[1];
  let bmax = 0, dmin = 0, ib = -1, id = -1;
  for (let i = 0; i < H.length; i++) {
    const s = dx * (H[i][1] - A[1]) - dy * (H[i][0] - A[0]);
    if (s > bmax) { bmax = s; ib = i; } if (s < dmin) { dmin = s; id = i; }
  }
  if (ib < 0 || id < 0) return null;
  // order along hull
  const idx = [ia, ib, ic, id].sort((a, b) => a - b);
  return idx.map(i => H[i].slice());
}

function fitLine(pts) { // TLS: returns [nx, ny, c] with nx*x+ny*y=c
  let mx = 0, my = 0; for (const p of pts) { mx += p[0]; my += p[1]; } mx /= pts.length; my /= pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const a = p[0] - mx, b = p[1] - my; sxx += a * a; sxy += a * b; syy += b * b; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); // direction angle
  const nx = -Math.sin(th), ny = Math.cos(th);
  return [nx, ny, nx * mx + ny * my];
}
function intersect(L1, L2) {
  const d = L1[0] * L2[1] - L1[1] * L2[0]; if (Math.abs(d) < 1e-9) return null;
  return [(L1[2] * L2[1] - L1[1] * L2[2]) / d, (L1[0] * L2[2] - L1[2] * L2[0]) / d];
}

// ---------- homography ----------
function solve(A, b) { // Gaussian elimination, in place
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
// maps src -> dst, least squares for n>=4 (normalized)
function homography(src, dst) {
  const norm = P => {
    let mx = 0, my = 0; for (const p of P) { mx += p[0]; my += p[1]; } mx /= P.length; my /= P.length;
    let d = 0; for (const p of P) d += Math.hypot(p[0] - mx, p[1] - my); d /= P.length;
    const s = Math.SQRT2 / (d || 1); return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
  };
  const Ts = norm(src), Td = norm(dst);
  const S = src.map(p => apply(Ts, p)), D = dst.map(p => apply(Td, p));
  const M = Array.from({ length: 8 }, () => new Array(8).fill(0)), v = new Array(8).fill(0);
  for (let i = 0; i < S.length; i++) {
    const [x, y] = S[i], [u, w] = D[i];
    const r1 = [x, y, 1, 0, 0, 0, -u * x, -u * y], r2 = [0, 0, 0, x, y, 1, -w * x, -w * y];
    for (const [r, t] of [[r1, u], [r2, w]]) for (let a = 0; a < 8; a++) { v[a] += r[a] * t; for (let b = 0; b < 8; b++) M[a][b] += r[a] * r[b]; }
  }
  const h = solve(M, v); if (!h) return null;
  const Hn = [...h, 1];
  return mul(inv(Td), mul(Hn, Ts));
}
function apply(H, p) { const w = H[6] * p[0] + H[7] * p[1] + H[8]; return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w]; }
function mul(A, B) { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; }
function inv(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

// ---------- marker detection ----------
function decodeQuad(g, w, h, Q) {
  const Hm = homography([[0, 0], [6, 0], [6, 6], [0, 6]], Q); if (!Hm) return null;
  const v = new Array(36);
  for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 6; cx++) {
    let s = 0, n = 0;
    for (const oy of [-0.2, 0, 0.2]) for (const ox of [-0.2, 0, 0.2]) {
      const p = apply(Hm, [cx + 0.5 + ox, cy + 0.5 + oy]); const t = bilinear(g, w, h, p[0], p[1]);
      if (t < 0) return null; s += t; n++;
    }
    v[cy * 6 + cx] = s / n;
  }
  // Otsu on 36 values
  const srt = v.slice().sort((a, b) => a - b);
  if (srt[35] - srt[0] < 25) return null;
  let bestT = 0, bestV = -1;
  for (let k = 1; k < 36; k++) {
    let m0 = 0, m1 = 0; for (let i = 0; i < k; i++) m0 += srt[i]; for (let i = k; i < 36; i++) m1 += srt[i];
    m0 /= k; m1 /= 36 - k; const bv = k * (36 - k) * (m1 - m0) ** 2;
    if (bv > bestV) { bestV = bv; bestT = (srt[k - 1] + srt[k]) / 2; }
  }
  const bit = v.map(x => x > bestT ? 1 : 0);
  let borderErr = 0;
  for (let i = 0; i < 6; i++) borderErr += bit[i] + bit[30 + i] + (i > 0 && i < 5 ? bit[i * 6] + bit[i * 6 + 5] : 0);
  if (borderErr > 2) return null;
  const inner = []; for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) inner.push(bit[y * 6 + x]);
  let best = null;
  for (let id = 0; id < CODES.length; id++) for (let r = 0; r < 4; r++) {
    let d = 0; const c = CODE_ROTS[id][r]; for (let i = 0; i < 16; i++) d += c[i] !== inner[i];
    if (!best || d < best.ham) best = { id, rot: r, ham: d };
  }
  if (best.ham > 1) return null;
  best.contrast = srt[35] - srt[0];
  return best;
}

function detectMarkers(g, w, h, opt = {}) {
  const I = integral(g, w, h);
  const minSide = opt.minSide || Math.max(12, Math.round(Math.max(w, h) / 120));
  const maxSide = opt.maxSide || Math.round(Math.max(w, h) / 4);
  const wins = opt.wins || [Math.round(minSide * 0.8) | 1, Math.round(minSide * 1.6) | 1, Math.round(minSide * 3) | 1];
  const found = [];
  const passes = [];
  for (const win of wins) passes.push([win, 0]);
  for (const r of (opt.openR || [2, 3])) passes.push([wins[1], r]);
  for (const [win, openR] of passes) {
    let bin = adaptive(g, w, h, I, win, opt.C || 7);
    if (openR) bin = openBin(bin, w, h, openR);
    const { lab, stats } = components(bin, w, h);
    for (const s of stats) {
      const bw = s.x1 - s.x0 + 1, bh = s.y1 - s.y0 + 1;
      if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
      if (bw / bh > 4 || bh / bw > 4) continue;
      const fill = s.n / (bw * bh); if (fill < 0.12 || fill > 0.95) continue;
      const bnd = [];
      for (let y = s.y0; y <= s.y1; y++) for (let x = s.x0; x <= s.x1; x++) {
        const i = y * w + x; if (lab[i] !== s.l) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || lab[i - 1] !== s.l || lab[i + 1] !== s.l || lab[i - w] !== s.l || lab[i + w] !== s.l) bnd.push([x, y]);
      }
      const Hl = hull(bnd.slice()); const ha = polyArea(Hl);
      let Q = quadFromHull(Hl); if (!Q) continue;
      const qa = Math.abs(polyArea(Q)); if (qa < 0.85 * Math.abs(ha)) continue;
      // side-length sanity
      const sides = Q.map((p, i) => Math.hypot(p[0] - Q[(i + 1) % 4][0], p[1] - Q[(i + 1) % 4][1]));
      if (Math.min(...sides) < 0.3 * Math.max(...sides)) continue;
      // refine sides by line fit on outer boundary pixels
      const tol = Math.max(1.2, Math.min(2.5, Math.min(...sides) / 16));
      const lines = [];
      for (let k = 0; k < 4; k++) {
        const P = Q[k], R = Q[(k + 1) % 4], L = sides[k], ux = (R[0] - P[0]) / L, uy = (R[1] - P[1]) / L;
        const sel = bnd.filter(q => { const t = ((q[0] - P[0]) * ux + (q[1] - P[1]) * uy) / L; const d = Math.abs(-(q[0] - P[0]) * uy + (q[1] - P[1]) * ux); return t > 0.12 && t < 0.88 && d < tol; });
        lines.push(sel.length >= 5 ? fitLine(sel) : null);
      }
      if (lines.every(Boolean)) {
        const R = []; for (let k = 0; k < 4; k++) R.push(intersect(lines[(k + 3) % 4], lines[k]));
        if (R.every(p => p && Math.hypot(p[0] - Q[R.indexOf(p)][0], p[1] - Q[R.indexOf(p)][1]) < 0.15 * Math.min(...sides))) Q = R;
      }
      if (polyArea(Q) < 0) Q.reverse(); // image coords: clockwise visually
      const dec = decodeQuad(g, w, h, Q); if (!dec) continue;
      const ctr = intersect(lineThrough(Q[0], Q[2]), lineThrough(Q[1], Q[3]));
      found.push({ id: dec.id, ham: dec.ham, contrast: dec.contrast, corners: Q, center: ctr, side: sides.reduce((a, b) => a + b) / 4, win });
    }
  }
  // dedupe
  found.sort((a, b) => a.ham - b.ham || b.side - a.side);
  const out = [];
  for (const f of found) if (!out.some(o => Math.hypot(o.center[0] - f.center[0], o.center[1] - f.center[1]) < f.side / 2)) out.push(f);
  return out;
}
// morphological opening (square kernel radius r) via integral of binary image
function boxAll(bin, w, h, r, val) { // out=1 where all pixels in box == val
  const W1 = w + 1, I = new Int32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += bin[y * w + x] === val ? 1 : 0; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + s; } }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) === (y1 - y0) * (x1 - x0) ? 1 : 0;
    }
  }
  return out;
}
function openBin(bin, w, h, r) {
  const er = boxAll(bin, w, h, r, 1);          // erosion
  const nz = boxAll(er, w, h, r, 0);           // box all-zero in eroded
  for (let i = 0; i < nz.length; i++) nz[i] = nz[i] ? 0 : 1; // dilation
  return nz;
}
function lineThrough(a, b) { const nx = b[1] - a[1], ny = a[0] - b[0]; return [nx, ny, nx * a[0] + ny * a[1]]; }

const CORNER_NAMES = ['lewym górnym', 'prawym górnym', 'prawym dolnym', 'lewym dolnym'];

// Assign TL,TR,BR,BL by position (not by ID). Returns {ok, pts:[TL,TR,BR,BL], markers, msg}
function assignCorners(markers) {
  // choose the marker set (target) with most markers; ties -> lower hamming sum
  const bySet = new Map();
  for (const m of markers) { const k = Math.floor(m.id / 4); if (!bySet.has(k)) bySet.set(k, []); bySet.get(k).push(m); }
  let set = null, best = null;
  for (const [k, arr] of bySet) { const ids = new Set(arr.map(m => m.id)).size, hs = arr.reduce((s, m) => s + m.ham, 0); if (!best || ids > best[0] || (ids === best[0] && hs < best[1])) { best = [ids, hs]; set = k; } }
  const res = assignSet(set == null ? [] : bySet.get(set));
  res.set = set; return res;
}
function assignSet(M) {
  // one per ID max
  const byId = new Map(); for (const m of M) if (!byId.has(m.id) || byId.get(m.id).ham > m.ham) byId.set(m.id, m);
  M = [...byId.values()];
  if (M.length === 4) {
    const cx = M.reduce((s, m) => s + m.center[0], 0) / 4, cy = M.reduce((s, m) => s + m.center[1], 0) / 4;
    const q = [null, null, null, null];
    for (const m of M) { const dx = m.center[0] - cx, dy = m.center[1] - cy; const k = dy < 0 ? (dx < 0 ? 0 : 1) : (dx < 0 ? 3 : 2); if (q[k]) q[k] = 'dup'; else q[k] = m; }
    if (q.every(x => x && x !== 'dup')) return { ok: true, pts: q.map(m => m.center), markers: q, msg: 'Cztery markery' };
    // fallback: angular order starting from min(x+y)
    const s = M.slice().sort((a, b) => Math.atan2(a.center[1] - cy, a.center[0] - cx) - Math.atan2(b.center[1] - cy, b.center[0] - cx));
    let k0 = 0; s.forEach((m, i) => { if (m.center[0] + m.center[1] < s[k0].center[0] + s[k0].center[1]) k0 = i; });
    const o = [0, 1, 2, 3].map(i => s[(k0 + i) % 4]);
    return { ok: true, pts: o.map(m => m.center), markers: o, msg: 'Cztery markery (kolejność kątowa)' };
  }
  if (M.length === 3) {
    // missing corner = parallelogram completion
    let bi = 0, bd = 0;
    for (let i = 0; i < 3; i++) { const a = M[(i + 1) % 3].center, b = M[(i + 2) % 3].center, d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > bd) { bd = d; bi = i; } }
    const B = M[bi].center, A = M[(bi + 1) % 3].center, C = M[(bi + 2) % 3].center;
    const D = [A[0] + C[0] - B[0], A[1] + C[1] - B[1]];
    const cx = (A[0] + C[0]) / 2, cy = (A[1] + C[1]) / 2;
    const k = D[1] < cy ? (D[0] < cx ? 0 : 1) : (D[0] < cx ? 3 : 2);
    return { ok: false, missing: k, markers: M, msg: `Nie czyta się marker w ${CORNER_NAMES[k]} rogu — przejdź dwa kroki w bok albo stań bardziej na wprost.` };
  }
  return { ok: false, markers: M, msg: M.length ? `Widać tylko ${M.length} marker(y) z 4 — podejdź bliżej lub zmniejsz kąt.` : 'Nie widać markerów — sprawdź, czy arkusz jest w kadrze.' };
}

// ---------- photometric reference from marker paper ----------
function colorRef(rgba, w, h, markers) {
  const W = [0, 0, 0], K = [0, 0, 0]; let nw = 0, nk = 0;
  for (const m of markers) {
    const Hm = homography([[0, 0], [6, 0], [6, 6], [0, 6]], m.corners); if (!Hm) continue;
    const cells = [];
    for (let cy = 0; cy < 6; cy++) for (let cx = 0; cx < 6; cx++) {
      const c = [0, 0, 0]; let n = 0;
      for (const oy of [-0.2, 0, 0.2]) for (const ox of [-0.2, 0, 0.2]) {
        const p = apply(Hm, [cx + 0.5 + ox, cy + 0.5 + oy]), x = Math.round(p[0]), y = Math.round(p[1]);
        if (x < 0 || y < 0 || x >= w || y >= h) continue; const i = (y * w + x) * 4;
        c[0] += rgba[i]; c[1] += rgba[i + 1]; c[2] += rgba[i + 2]; n++;
      }
      if (n) cells.push({ c: c.map(v => v / n), L: (c[0] + c[1] + c[2]) / n, border: cx === 0 || cy === 0 || cx === 5 || cy === 5 });
    }
    const Ls = cells.map(c => c.L).sort((a, b) => a - b), thr = (Ls[0] + Ls[Ls.length - 1]) / 2;
    for (const c of cells) {
      if (c.L > thr && !c.border) { for (let k = 0; k < 3; k++) W[k] += c.c[k]; nw++; }
      else if (c.L < thr && c.border) { for (let k = 0; k < 3; k++) K[k] += c.c[k]; nk++; }
    }
  }
  if (!nw || !nk) return null;
  return { w: W.map(v => v / nw), k: K.map(v => v / nk) };
}
function makeLUT(ref) { // per-channel LUT: black ref -> 20, white ref -> 235
  const L = [new Uint8Array(256), new Uint8Array(256), new Uint8Array(256)];
  for (let c = 0; c < 3; c++) for (let v = 0; v < 256; v++) {
    const t = ref ? 20 + (v - ref.k[c]) / Math.max(10, ref.w[c] - ref.k[c]) * 215 : v;
    L[c][v] = Math.max(0, Math.min(255, Math.round(t)));
  }
  return L;
}

// ---------- face model & scoring ----------
const FACES = [
  { id: 'wa122', name: 'WA 122 cm', D: 1220, min: 1 },
  { id: 'wa80', name: 'WA 80 cm', D: 800, min: 1 },
  { id: 'wa80_6', name: 'WA 80 cm — 6 pierścieni (5–X)', D: 800, min: 5 },
  { id: 'wa60', name: 'WA 60 cm', D: 600, min: 1 },
  { id: 'wa40', name: 'WA 40 cm', D: 400, min: 1 },
];
function score(r, D, shaftOD, minRing = 1) {
  const rt = shaftOD / 2, e = r - rt;
  let s = Math.floor(11 - 20 * e / D + 1e-9);
  s = Math.max(0, Math.min(10, s));
  if (s < minRing) s = 0;
  const X = e <= D / 40;
  return { score: s, X: s === 10 && X, label: s === 0 ? 'M' : (s === 10 && X ? 'X' : String(s)) };
}

// ---------- rectification & colour ----------
function classify(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx / 255, s = mx ? (mx - mn) / mx : 0;
  let hh = 0;
  if (mx !== mn) { if (mx === r) hh = ((g - b) / (mx - mn)) % 6; else if (mx === g) hh = (b - r) / (mx - mn) + 2; else hh = (r - g) / (mx - mn) + 4; hh *= 60; if (hh < 0) hh += 360; }
  if (s > 0.3 && v > 0.25) {
    if (hh >= 35 && hh <= 80) return 1;          // yellow
    if (hh <= 25 || hh >= 320) return 2;          // red
    if (hh >= 180 && hh <= 255) return 3;         // blue
  }
  if (v < 0.32 && s < 0.45) return 4;            // black
  if (v > 0.5 && s < 0.22) return 5;             // white
  return 0;
}
// render region of marker frame (mm) into RGB + class arrays at 1 px/mm
function rectify(rgba, w, h, Hmm2px, box, lut) {
  lut = lut || makeLUT(null);
  const [X0, Y0, X1, Y1] = box, W = X1 - X0, Hh = Y1 - Y0;
  const cls = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const p = apply(Hmm2px, [X0 + x + 0.5, Y0 + y + 0.5]);
    const px = Math.round(p[0]), py = Math.round(p[1]);
    if (px < 0 || py < 0 || px >= w || py >= h) { cls[y * W + x] = 255; continue; }
    const i = (py * w + px) * 4; cls[y * W + x] = classify(lut[0][rgba[i]], lut[1][rgba[i + 1]], lut[2][rgba[i + 2]]);
  }
  return { cls, W, H: Hh, X0, Y0 };
}

// conic fit x^2 + Bxy + Cy^2 + Dx + Ey + F = 0 -> {c, Q}
function fitConic(P) {
  const M = Array.from({ length: 5 }, () => new Array(5).fill(0)), v = new Array(5).fill(0);
  let mx = 0, my = 0; for (const p of P) { mx += p[0]; my += p[1]; } mx /= P.length; my /= P.length;
  for (const p of P) {
    const x = p[0] - mx, y = p[1] - my, r = [x * y, y * y, x, y, 1], t = -x * x;
    for (let a = 0; a < 5; a++) { v[a] += r[a] * t; for (let b = 0; b < 5; b++) M[a][b] += r[a] * r[b]; }
  }
  const s = solve(M, v); if (!s) return null;
  const [B, C, D, E, F] = s;
  const det = 4 * C - B * B; if (det <= 0) return null;
  const cx = (B * E - 2 * C * D) / det, cy = (B * D - 2 * E) / det;
  const k = cx * cx + B * cx * cy + C * cy * cy - F; if (k <= 0) return null;
  const Q = [1 / k, B / 2 / k, C / k]; // [q11,q12,q22]
  return { c: [cx + mx, cy + my], Q };
}
const qform = (Q, d) => Q[0] * d[0] * d[0] + 2 * Q[1] * d[0] * d[1] + Q[2] * d[1] * d[1];

function robustConic(P) {
  let pts = P, fit = null;
  for (let it = 0; it < 4; it++) {
    if (pts.length < 20) return null;
    fit = fitConic(pts); if (!fit) return null;
    const rm = 1 / Math.sqrt(Math.sqrt(fit.Q[0] * fit.Q[2] - fit.Q[1] ** 2));
    const res = pts.map(p => Math.abs(Math.sqrt(qform(fit.Q, [p[0] - fit.c[0], p[1] - fit.c[1]])) - 1) * rm);
    const med = res.slice().sort((a, b) => a - b)[res.length >> 1];
    const lim = Math.max(1.5, 3.5 * 1.48 * med);
    const np = pts.filter((p, i) => res[i] < lim);
    fit.n = np.length; fit.rm = rm; fit.rms = Math.sqrt(res.filter(r => r < lim).reduce((a, b) => a + b * b, 0) / Math.max(1, np.length));
    if (np.length === pts.length) break; pts = np;
  }
  return fit;
}

function sqrtm2(a, b, c) { // sqrt of SPD [[a,b],[b,c]]
  const d = Math.sqrt(a * c - b * b), t = Math.sqrt(a + c + 2 * d);
  return [(a + d) / t, b / t, (c + d) / t];
}

/* Calibrate face from a (preferably clean) photo.
   Hpx: marker-frame mm -> image px. rect: [W,H] marker rectangle (mm).
   Returns profile {c:[x,y] mm in marker frame, A:[a,b,c] sym 2x2 (marker-mm -> face-mm), s, bias, ovality, fits} */
function calibrateFace(rgba, w, h, Hpx, rect, D, lut) {
  const [Wm, Hm] = rect, pad = D * 0.25;
  const box = [Math.round(-pad), Math.round(-pad), Math.round(Wm + pad), Math.round(Hm + pad)];
  const R = rectify(rgba, w, h, Hpx, box, lut);
  // initial centre: yellow pixels, iterative local centroid
  let sx = 0, sy = 0, n = 0;
  const ys = [];
  for (let y = 0; y < R.H; y++) for (let x = 0; x < R.W; x++) if (R.cls[y * R.W + x] === 1) ys.push([x, y]);
  if (ys.length < 200) return { ok: false, msg: 'Nie widać żółtego pola — czy to właściwe lico i rozmiar?' };
  const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
  let c = [med(ys.map(p => p[0])), med(ys.map(p => p[1]))];
  const r9 = D / 10; // yellow outer radius nominal
  for (let it = 0; it < 4; it++) {
    sx = sy = n = 0;
    for (const p of ys) if (Math.hypot(p[0] - c[0], p[1] - c[1]) < r9 * 1.3) { sx += p[0]; sy += p[1]; n++; }
    if (n < 100) break; c = [sx / n, sy / n];
  }
  const s0 = Math.sqrt(n / Math.PI) / r9 || 1;
  // rays
  const seq = [[1, 2], [2, 3], [3, 4], [4, 5]]; // Y->R, R->B, B->K, K->W
  const Rk = [2, 4, 6, 8].map(k => k * D / 20);
  const pts = [[], [], [], []];
  const step = 0.5, NR = 720;
  for (let a = 0; a < NR; a++) {
    const th = a / NR * 2 * Math.PI, ux = Math.cos(th), uy = Math.sin(th);
    const rmax = Rk[3] * s0 * 1.25, n1 = Math.ceil(rmax / step);
    const cl = new Uint8Array(n1);
    for (let i = 0; i < n1; i++) {
      const x = Math.round(c[0] + ux * i * step), y = Math.round(c[1] + uy * i * step);
      cl[i] = (x < 0 || y < 0 || x >= R.W || y >= R.H) ? 255 : R.cls[y * R.W + x];
    }
    for (let k = 0; k < 4; k++) {
      const [ca, cb] = seq[k], e = Rk[k] * s0;
      const i0 = Math.floor(e * 0.82 / step), i1 = Math.min(n1 - 1, Math.ceil(e * 1.18 / step));
      const RUN = 6, GAP = 12; // 3 mm run, 6 mm max gap
      let lastA = -1, bestPos = -1;
      for (let i = i0; i <= i1; i++) {
        if (cl[i] === ca) lastA = i;
        if (cl[i] === cb && lastA >= 0 && i - lastA <= GAP) {
          let ok = true; for (let j = i; j < i + RUN && j < n1; j++) if (cl[j] !== cb) { ok = false; break; }
          let okA = true; for (let j = lastA; j > lastA - RUN && j >= 0; j--) if (cl[j] !== ca) { okA = false; break; }
          if (ok && okA) { bestPos = (lastA + i) / 2 * step; break; }
        }
      }
      if (bestPos > 0) pts[k].push([c[0] + ux * bestPos + R.X0, c[1] + uy * bestPos + R.Y0]);
    }
  }
  const fits = pts.map(robustConic);
  const good = fits.map((f, k) => f && f.n > 150 ? k : -1).filter(k => k >= 0);
  if (good.length < 3) return { ok: false, msg: 'Za mało czytelnych granic stref koloru — zrób zdjęcie kalibracyjne czystej tarczy.', fits, pts };
  // regression r = s*R + b
  let Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, W = 0;
  for (const k of good) { const x = Rk[k], y = fits[k].rm, wt = fits[k].n; Sx += wt * x; Sy += wt * y; Sxx += wt * x * x; Sxy += wt * x * y; W += wt; }
  const s = (W * Sxy - Sx * Sy) / (W * Sxx - Sx * Sx), b = (Sy - s * Sx) / W;
  // centre & shape: weighted avg (weights by radius*count)
  let cx = 0, cy = 0, N = [0, 0, 0], wsum = 0;
  for (const k of good) {
    const f = fits[k], wt = f.n, dq = Math.sqrt(f.Q[0] * f.Q[2] - f.Q[1] ** 2);
    cx += wt * f.c[0]; cy += wt * f.c[1];
    N[0] += wt * f.Q[0] / dq; N[1] += wt * f.Q[1] / dq; N[2] += wt * f.Q[2] / dq; wsum += wt;
  }
  cx /= wsum; cy /= wsum; N = N.map(v => v / wsum);
  const dn = Math.sqrt(N[0] * N[2] - N[1] ** 2); N = N.map(v => v / dn);
  const S = sqrtm2(N[0], N[1], N[2]);
  const A = S.map(v => v / s);
  const tr = N[0] + N[2], ev1 = tr / 2 + Math.sqrt(tr * tr / 4 - 1), ovality = Math.sqrt(ev1 / (1 / ev1));
  const centreSpread = Math.max(...good.map(k => Math.hypot(fits[k].c[0] - cx, fits[k].c[1] - cy)));
  if (Math.abs(s - 1) > 0.2) return { ok: false, msg: `Skala odbiega o ${((s - 1) * 100).toFixed(0)}% od oczekiwanej — sprawdź wybrany rozmiar lica i rozstaw markerów.`, s };
  return {
    ok: true, c: [cx, cy], A, s, bias: b, ovality, centreSpread,
    fits: fits.map((f, k) => f && { k, n: f.n, rm: f.rm, rms: f.rms, c: f.c, expected: Rk[k] }), pts
  };
}

// marker-frame mm -> face mm (and inverse)
function mmToFace(P, p) { const d = [p[0] - P.c[0], p[1] - P.c[1]]; return [P.A[0] * d[0] + P.A[1] * d[1], P.A[1] * d[0] + P.A[2] * d[1]]; }
function faceToMm(P, f) {
  const [a, b, c] = P.A, det = a * c - b * b;
  return [P.c[0] + (c * f[0] - b * f[1]) / det, P.c[1] + (-b * f[0] + a * f[1]) / det];
}

/* Gate: re-fit the colour boundaries on this photo and compare with the station profile.
   Returns {state:'green'|'amber'|'red', dev (mm), dScale, msg}. */
function verifyProfile(rgba, w, h, Hpx, rect, D, lut, P) {
  const Q = calibrateFace(rgba, w, h, Hpx, rect, D, lut);
  if (!Q.ok) return { state: 'amber', dev: null, msg: 'Nie da się potwierdzić nakładki (za dużo zasłonięte) — sprawdź pierścienie wzrokiem.' };
  const dv = mmToFace(P, Q.c), dev = Math.hypot(dv[0], dv[1]), dScale = Q.s / P.s - 1;
  let state = 'green', msg = `Nakładka siada: odchyłka środka ${dev.toFixed(1)} mm.`;
  if (dev > 8 || Math.abs(dScale) > 0.03) { state = 'red'; msg = `Nakładka nie siada (odchyłka ${dev.toFixed(1)} mm, skala ${(dScale * 100).toFixed(1)}%). Lico albo marker się przesunął — zrób nowe zdjęcie kalibracyjne.`; }
  else if (dev > 4 || Math.abs(dScale) > 0.015) { state = 'amber'; msg = `Odchyłka środka ${dev.toFixed(1)} mm — sprawdź, czy pierścienie leżą na nadruku.`; }
  return { state, dev, dScale, fit: Q, msg };
}

const API = { NSETS, colorRef, makeLUT, CODES, FACES, toGray, detectMarkers, assignCorners, homography, apply, inv, mul, calibrateFace, verifyProfile, mmToFace, faceToMm, score, classify, rectify, CORNER_NAMES };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ANCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
