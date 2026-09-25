/* ArcheryNote stats — session metrics and the summary card (SVG).
   Zero dependencies. Browser: window.ANStats; Node: module.exports.
   Coordinates: x right, y UP, millimetres from face centre.
   AR & Claude (Anthropic) */
(function (root) {
'use strict';

const FACE_D = { wa122: 1220, wa80: 800, wa80_6: 800, wa60: 600, wa40: 400 };
const FACE_MIN = { wa80_6: 5 };
const FACE_NAME = { wa122: 'WA 122 cm', wa80: 'WA 80 cm', wa80_6: 'WA 80 cm (6 pierścieni)', wa60: 'WA 60 cm', wa40: 'WA 40 cm' };

function pct(sorted, p) { // linear interpolation (type 7)
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
function sd(a) { if (a.length < 2) return null; const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); }

// metrics for any list of arrows {x,y,score,label,state}
function group(arrows) {
  const shot = arrows.filter(a => a.state !== 'nieoddana');
  const hits = shot.filter(a => a.x != null && a.y != null);
  const sum = shot.reduce((s, a) => s + (a.score || 0), 0);
  const out = {
    n: shot.length, hits: hits.length, sum, avg: shot.length ? sum / shot.length : null,
    tens: shot.filter(a => a.score === 10).length, xs: shot.filter(a => a.label === 'X').length,
    misses: shot.filter(a => a.score === 0).length
  };
  if (hits.length >= 2) {
    const mx = hits.reduce((s, a) => s + a.x, 0) / hits.length, my = hits.reduce((s, a) => s + a.y, 0) / hits.length;
    const d = hits.map(a => Math.hypot(a.x - mx, a.y - my)).sort((p, q) => p - q);
    Object.assign(out, { mx, my, d100: 2 * d[d.length - 1], d90: 2 * pct(d, 0.9), sx: sd(hits.map(a => a.x)), sy: sd(hits.map(a => a.y)) });
  }
  return out;
}

function summary(session) {
  const ends = session.ends || [];
  const all = [].concat(...ends.map(e => e.arrows.map(a => Object.assign({ end: e.nr }, a))));
  const g = group(all);
  const times = ends.map(e => e.time).filter(Boolean);
  const t0 = times.length ? Math.min(...times) : null, t1 = times.length ? Math.max(...times) : null;
  const e0 = ends[0] || {};
  return Object.assign(g, {
    id: session.id, date: session.date, status: session.status || 'robocza', archerId: session.archerId || null, archer: session.archer || null, station: session.station || null,
    face: e0.face || session.face, dist: e0.dist != null ? e0.dist : session.dist, perEnd: e0.n,
    endsCount: ends.length, t0, t1, minutes: t0 != null && t1 > t0 ? (t1 - t0) / 60000 : null,
    ends: ends.map(e => Object.assign(group(e.arrows), { nr: e.nr, time: e.time })),
    arrows: all
  });
}

// previous closed sessions, same face and distance, newest first
function comparable(history, cur, max = 5) {
  return history
    .filter(s => s.id !== cur.id && (s.status === 'zamknieta') && s.ends && s.ends.length)
    .map(summary)
    .filter(s => s.face === cur.face && s.dist === cur.dist && (s.archerId || null) === (cur.archerId || null) && new Date(s.date) < new Date(cur.date))
    .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, max);
}

// ---------- formatting ----------
const nf = (v, d = 0) => v == null || !isFinite(v) ? '—' : v.toFixed(d).replace('.', ',').replace(/^-0(,0+)?$/, '0$1');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtDate(iso, t0, t1) {
  const d = new Date(iso), days = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
  const hm = t => { const x = new Date(t); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
  let s = `${days[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  if (t0) s += `, ${hm(t0)}` + (t1 && t1 - t0 > 60000 ? `–${hm(t1)}` : '');
  return s;
}
function offsetText(mx, my) {
  if (mx == null) return '—';
  const h = Math.abs(mx) < 3 ? 'w poziomie w osi' : `${nf(Math.abs(mx))} mm w ${mx > 0 ? 'prawo' : 'lewo'}`;
  const v = Math.abs(my) < 3 ? 'w pionie w osi' : `${nf(Math.abs(my))} mm w ${my > 0 ? 'górę' : 'dół'}`;
  return `${h} · ${v}`;
}

// ---------- card ----------
const T = { bg: '#14181c', panel: '#1d2329', line: '#2c343c', fg: '#e8ecef', fg2: '#b9c3cb', mut: '#8a97a2', acc: '#f2c230', s1: '#3987e5' };
const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

function txt(x, y, s, o = {}) {
  return `<text x="${x}" y="${y}" fill="${o.fill || T.fg}" font-size="${o.size || 22}" font-weight="${o.w || 400}" text-anchor="${o.anchor || 'start'}"${o.cls ? ` class="${o.cls}"` : ''}>${esc(s)}</text>`;
}

function targetPlot(sum, x0, y0, size) {
  const D = FACE_D[sum.face] || 800, minRing = FACE_MIN[sum.face] || 1, R = D / 2;
  const hits = sum.arrows.filter(a => a.x != null);
  const far = hits.reduce((m, a) => Math.max(m, Math.hypot(a.x, a.y)), 0);
  const zone = D / 20;
  let E = Math.min(R, Math.max(4 * zone, Math.ceil((far + zone * 0.6) / zone) * zone)) + zone * 0.35;
  const k = size / 2 / E, cx = x0 + size / 2, cy = y0 + size / 2;
  const P = (x, y) => [cx + x * k, cy - y * k];
  const fills = ['#e6e6e2', '#e6e6e2', '#2a2a2a', '#2a2a2a', '#1e88e5', '#1e88e5', '#e53935', '#e53935', '#fdd835', '#fdd835'];
  let s = `<clipPath id="tclip"><rect x="${x0}" y="${y0}" width="${size}" height="${size}" rx="14"/></clipPath><g clip-path="url(#tclip)"><rect x="${x0}" y="${y0}" width="${size}" height="${size}" fill="#101418"/>`;
  for (let n = minRing; n <= 10; n++) {
    const r = (11 - n) * zone * k;
    s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fills[n - 1]}" fill-opacity="0.26" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1"/>`;
  }
  s += `<circle cx="${cx}" cy="${cy}" r="${zone / 2 * k}" fill="none" stroke="#ffffff" stroke-opacity="0.22"/>`;
  // ring numbers along +x
  for (let n = Math.max(minRing, 1); n <= 9; n++) {
    const r = (10.5 - n) * zone * k; if (r > size / 2 - 10) continue;
    s += `<text x="${cx + r}" y="${cy + 6}" fill="#ffffff" fill-opacity="0.4" font-size="12" text-anchor="middle">${n}</text>`;
  }
  // D90 circle + centre
  if (sum.mx != null) {
    const [gx, gy] = P(sum.mx, sum.my);
    s += `<circle cx="${gx}" cy="${gy}" r="${sum.d90 / 2 * k}" fill="none" stroke="${T.acc}" stroke-width="1.8" stroke-dasharray="5 4"/>`;
  }
  for (const a of hits) {
    const [px, py] = P(a.x, a.y);
    s += `<circle class="dot" data-end="${a.end}" cx="${px}" cy="${py}" r="5.5" fill="#ffffff" stroke="#101418" stroke-width="2"><title>Seria ${a.end}, strzała ${a.nr}: ${a.label} (${nf(a.x)} / ${nf(a.y)} mm)</title></circle>`;
  }
  if (sum.mx != null) {
    const [gx, gy] = P(sum.mx, sum.my);
    s += `<path d="M${gx - 9} ${gy}H${gx + 9}M${gx} ${gy - 9}V${gy + 9}" stroke="#101418" stroke-width="5"/><path d="M${gx - 9} ${gy}H${gx + 9}M${gx} ${gy - 9}V${gy + 9}" stroke="${T.acc}" stroke-width="2.5"/>`;
  }
  s += `</g>`;
  s += `<rect x="${x0 + 6}" y="${y0 + size - 28}" width="102" height="22" rx="5" fill="#101418" fill-opacity="0.85"/>` + txt(x0 + 12, y0 + size - 12, `widok ±${nf(E / 10)} cm`, { size: 12, fill: T.fg2 });
  return s;
}

function barChart(ends, x0, y0, w, h, maxV) {
  const n = Math.max(ends.length, 1), padL = 30, padB = 24, cw = (w - padL) / n, bw = Math.min(34, cw * 0.62);
  const yv = v => y0 + (h - padB) * (1 - v / maxV);
  let s = '';
  for (const t of [0, maxV / 2, maxV]) s += `<line x1="${x0 + padL}" x2="${x0 + w}" y1="${yv(t)}" y2="${yv(t)}" stroke="${T.line}" stroke-width="1"/>` + txt(x0 + padL - 6, yv(t) + 4, nf(t), { size: 12, fill: T.mut, anchor: 'end' });
  ends.forEach((e, i) => {
    const cx = x0 + padL + cw * (i + 0.5), top = yv(e.sum), base = yv(0), r = Math.min(4, (base - top) / 2);
    s += `<g class="bar" data-end="${e.nr}"><rect x="${cx - cw / 2}" y="${y0}" width="${cw}" height="${h}" fill="transparent"/>`;
    if (e.sum > 0) s += `<path d="M${cx - bw / 2} ${base}V${top + r}Q${cx - bw / 2} ${top} ${cx - bw / 2 + r} ${top}H${cx + bw / 2 - r}Q${cx + bw / 2} ${top} ${cx + bw / 2} ${top + r}V${base}Z" fill="${T.s1}"/>`;
    s += txt(cx, top - 7, nf(e.sum), { size: 13, fill: T.fg2, anchor: 'middle' });
    s += txt(cx, y0 + h - 6, String(e.nr), { size: 12, fill: T.mut, anchor: 'middle' });
    s += `<title>Seria ${e.nr}: ${e.sum} pkt, średnica 90% ${nf(e.d90)} mm</title></g>`;
  });
  return s;
}

function lineChart(ends, x0, y0, w, h) {
  const pts = ends.filter(e => e.d90 != null);
  const maxV = Math.max(50, ...pts.map(e => e.d90)) * 1.15, step = maxV > 300 ? 100 : 50, top = Math.ceil(maxV / step) * step;
  const n = Math.max(ends.length, 1), padL = 34, padB = 24, cw = (w - padL) / n;
  const X = i => x0 + padL + cw * (i + 0.5), Y = v => y0 + (h - padB) * (1 - v / top);
  let s = '';
  for (let t = 0; t <= top; t += top / 2) s += `<line x1="${x0 + padL}" x2="${x0 + w}" y1="${Y(t)}" y2="${Y(t)}" stroke="${T.line}" stroke-width="1"/>` + txt(x0 + padL - 6, Y(t) + 4, nf(t), { size: 12, fill: T.mut, anchor: 'end' });
  const idx = ends.map((e, i) => [e, i]).filter(([e]) => e.d90 != null);
  if (idx.length > 1) s += `<path d="${idx.map(([e, i], k) => (k ? 'L' : 'M') + X(i) + ' ' + Y(e.d90)).join('')}" fill="none" stroke="${T.s1}" stroke-width="2"/>`;
  ends.forEach((e, i) => {
    s += txt(X(i), y0 + h - 6, String(e.nr), { size: 12, fill: T.mut, anchor: 'middle' });
    if (e.d90 == null) return;
    s += `<g class="bar" data-end="${e.nr}"><circle cx="${X(i)}" cy="${Y(e.d90)}" r="5" fill="${T.s1}" stroke="${T.panel}" stroke-width="2"/><title>Seria ${e.nr}: średnica 90% ${nf(e.d90)} mm</title></g>`;
  });
  // label extremes only
  if (idx.length > 1) {
    const hi = idx.reduce((m, p) => p[0].d90 > m[0].d90 ? p : m), lo = idx.reduce((m, p) => p[0].d90 < m[0].d90 ? p : m);
    for (const [e, i] of [hi, lo]) s += txt(X(i), Y(e.d90) - 12, nf(e.d90), { size: 13, fill: T.fg2, anchor: 'middle' });
  }
  return s;
}

// Phone-first single-column card, 480 units wide (≈ 1:1.3 on a phone screen, ×3 for PNG).
function cardSVG(session, history) {
  const S = summary(session), prev = comparable(history || [], S), W = 480, M = 16, IW = W - 2 * M;
  const pAvg = prev.length ? prev.reduce((s, p) => s + p.avg, 0) / prev.length : null;
  const pD90 = prev.filter(p => p.d90 != null); const pD = pD90.length ? pD90.reduce((s, p) => s + p.d90, 0) / pD90.length : null;
  let b = '', y = 0;
  const panel = (yy, h) => { b += `<rect x="${M}" y="${yy}" width="${IW}" height="${h}" rx="12" fill="${T.panel}"/>`; };
  // header
  b += txt(M, 40, 'Podsumowanie treningu', { size: 24, w: 700 });
  b += txt(W - M, 40, S.status === 'zamknieta' ? 'zamknięta' : 'w toku', { size: 13, fill: S.status === 'zamknieta' ? T.mut : T.acc, anchor: 'end' });
  b += txt(M, 66, (S.archer ? S.archer.name + ' · ' : '') + fmtDate(S.date, S.t0, S.t1), { size: 16, fill: T.fg2 });
  b += txt(M, 88, `${S.archer && S.archer.bow ? S.archer.bow + ' · ' : ''}${FACE_NAME[S.face] || S.face} · ${nf(S.dist)} m · ${S.endsCount} ${S.endsCount === 1 ? 'seria' : S.endsCount < 5 ? 'serie' : 'serii'} · ${S.n} strzał`, { size: 14, fill: T.mut });
  y = 104;
  // tiles 3×2
  const delta = (v, p, d, unit, lowerBetter) => {
    if (v == null || p == null) return '';
    const dv = v - p; if (Math.abs(dv) < Math.pow(10, -d) / 2) return '= poprzednim';
    return `${dv > 0 ? '▲' : '▼'} ${nf(Math.abs(dv), d)}${unit} ${(lowerBetter ? dv < 0 : dv > 0) ? 'lepiej' : 'gorzej'}`;
  };
  const tiles = [
    ['Suma', nf(S.sum), `z ${S.n * 10} możliwych`],
    ['Średnia/strzałę', nf(S.avg, 2), delta(S.avg, pAvg, 2, '', false)],
    ['10 / X', `${S.tens} / ${S.xs}`, `pudła: ${S.misses}`],
    ['Grupa 90%', S.d90 != null ? nf(S.d90) : '—', S.d90 != null ? (delta(S.d90, pD, 0, ' mm', true) || 'mm') : ''],
    ['Rozrzut σ', S.sx != null ? `${nf(S.sx)}/${nf(S.sy)}` : '—', S.sx != null ? 'poziomo/pionowo, mm' : ''],
    ['Czas', S.minutes >= 1 ? nf(S.minutes) + ' min' : '—', S.minutes >= 1 && S.endsCount > 1 ? `${nf(S.minutes / (S.endsCount - 1), 1)} min/seria` : '']
  ];
  const gap = 8, tw = (IW - 2 * gap) / 3, th = 78;
  tiles.forEach(([k, v, sub], i) => {
    const x = M + (i % 3) * (tw + gap), yy = y + Math.floor(i / 3) * (th + gap);
    b += `<rect x="${x}" y="${yy}" width="${tw}" height="${th}" rx="10" fill="${T.panel}"/>`;
    b += txt(x + 10, yy + 20, k, { size: 12.5, fill: T.mut }) + txt(x + 10, yy + 49, v, { size: 23, w: 700 }) + txt(x + 10, yy + 68, sub, { size: 11.5, fill: T.fg2 });
  });
  y += 2 * th + gap + 14;
  // target
  const ts = IW - 16;
  panel(y, ts + 16 + 34);
  b += targetPlot(S, M + 8, y + 8, ts);
  const ly = y + ts + 36;
  b += `<circle cx="${M + 20}" cy="${ly - 5}" r="6" fill="#fff" stroke="#101418" stroke-width="2"/>` + txt(M + 32, ly, 'trafienie', { size: 13, fill: T.fg2 });
  b += `<path d="M${M + 118} ${ly - 5}h22" stroke="${T.acc}" stroke-width="2" stroke-dasharray="5 4"/>` + txt(M + 146, ly, 'koło 90% grupy', { size: 13, fill: T.fg2 });
  b += `<path d="M${M + 268} ${ly - 5}h16M${M + 276} ${ly - 13}v16" stroke="${T.acc}" stroke-width="2.5"/>` + txt(M + 292, ly, 'środek grupy', { size: 13, fill: T.fg2 });
  y += ts + 16 + 34 + 12;
  // group facts
  const dir = (v, pos, neg) => Math.abs(v) < 3 ? 'w osi' : `${nf(Math.abs(v))} mm w ${v > 0 ? pos : neg}`;
  const facts = [
    ['Środek grupy', S.mx != null ? `${dir(S.mx, 'prawo', 'lewo')}, ${dir(S.my, 'górę', 'dół')}` : '—', S.mx != null ? 'celownik przesuwa się w stronę grupy' : ''],
    ['Skupienie', S.d90 != null ? `${nf(S.d90)} mm (90%) · ${nf(S.d100)} mm (wszystkie)` : '—', 'średnica koła wokół środka grupy'],
    ['Rozrzut w osiach', S.sx != null ? `poziomo ${nf(S.sx)} mm · pionowo ${nf(S.sy)} mm` : '—',
      S.sx == null ? '' : S.sy > S.sx * 1.25 ? 'przewaga pionowego: zmęczenie, niepewny klik' : S.sx > S.sy * 1.25 ? 'przewaga poziomego: postawa, ramię łuku, wiatr' : 'rozrzut podobny w obu osiach']
  ];
  const fh = 66; panel(y, facts.length * fh + 8);
  facts.forEach(([k, v, n], i) => {
    const yy = y + 8 + i * fh;
    if (i) b += `<line x1="${M + 12}" x2="${W - M - 12}" y1="${yy - 2}" y2="${yy - 2}" stroke="${T.line}"/>`;
    b += txt(M + 12, yy + 17, k, { size: 12.5, fill: T.mut }) + txt(M + 12, yy + 39, v, { size: 16.5, w: 650 }) + txt(M + 12, yy + 57, n, { size: 12.5, fill: T.fg2 });
  });
  y += facts.length * fh + 8 + 12;
  // per-end charts (stacked small multiples)
  const chH = 150;
  panel(y, chH + 40);
  b += txt(M + 12, y + 24, 'Suma w serii', { size: 15, w: 650 }) + txt(W - M - 12, y + 24, `maks. ${(S.perEnd || 6) * 10}`, { size: 12.5, fill: T.mut, anchor: 'end' });
  b += barChart(S.ends, M + 4, y + 36, IW - 16, chH, (S.perEnd || 6) * 10);
  y += chH + 40 + 12;
  panel(y, chH + 40);
  b += txt(M + 12, y + 24, 'Średnica serii 90% [mm]', { size: 15, w: 650 }) + txt(W - M - 12, y + 24, 'niżej = lepiej', { size: 12.5, fill: T.mut, anchor: 'end' });
  b += lineChart(S.ends, M + 4, y + 36, IW - 16, chH);
  y += chH + 40 + 12;
  // comparison table
  const rows = [S].concat(prev), rh = 30, tH = 62 + rows.length * rh + (prev.length ? 4 : 40);
  panel(y, tH);
  b += txt(M + 12, y + 24, 'Na tle poprzednich sesji', { size: 15, w: 650 }) + txt(W - M - 12, y + 24, `${(FACE_NAME[S.face] || S.face).replace('WA ', '')}, ${nf(S.dist)} m`, { size: 12.5, fill: T.mut, anchor: 'end' });
  const cols = [[M + 12, 'Data', 'start'], [M + 150, 'Strzał', 'end'], [M + 220, 'Średnia', 'end'], [M + 310, 'Grupa 90%', 'end'], [W - M - 12, 'Środek', 'end']];
  let ty = y + 48;
  cols.forEach(([x, h, a]) => { b += txt(x, ty, h, { size: 12, fill: T.mut, anchor: a }); });
  rows.forEach((r, i) => {
    ty += rh; const cur = i === 0, o = a => ({ size: 14, fill: cur ? T.fg : T.fg2, w: cur ? 650 : 400, anchor: a });
    if (cur) b += `<rect x="${M + 6}" y="${ty - 20}" width="${IW - 12}" height="28" rx="6" fill="#262e36"/>`;
    b += txt(cols[0][0], ty, fmtDate(r.date).replace(/^\S+ /, ''), o('start'));
    b += txt(cols[1][0], ty, String(r.n), o('end'));
    b += txt(cols[2][0], ty, nf(r.avg, 2), o('end'));
    b += txt(cols[3][0], ty, r.d90 != null ? nf(r.d90) + ' mm' : '—', o('end'));
    b += txt(cols[4][0], ty, r.mx != null ? `${nf(Math.abs(r.mx))}${r.mx >= 0 ? 'P' : 'L'} ${nf(Math.abs(r.my))}${r.my >= 0 ? 'G' : 'D'}` : '—', o('end'));
  });
  if (!prev.length) b += txt(M + 12, ty + 30, 'Porównanie pojawi się od następnej zamkniętej sesji', { size: 12.5, fill: T.mut }) + txt(M + 12, ty + 47, 'z tym samym licem i dystansem.', { size: 12.5, fill: T.mut });
  y += tH + 22;
  b += txt(M, y, 'ArcheryNote · AR & Claude (Anthropic)', { size: 11.5, fill: '#56616b' });
  const H = y + 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="${T.bg}"/>${b}</svg>`;
}

// ---------- trends across sessions ----------
function trendCombos(history, archerId) {
  const m = new Map();
  for (const h of history || []) {
    if (h.status !== 'zamknieta' || !h.ends || !h.ends.length || (h.archerId || null) !== (archerId || null)) continue;
    const S = summary(h), k = S.face + '|' + S.dist;
    const c = m.get(k) || { face: S.face, dist: S.dist, count: 0, last: 0 };
    c.count++; c.last = Math.max(c.last, new Date(S.date).getTime()); m.set(k, c);
  }
  return [...m.values()].sort((a, b) => b.last - a.last);
}
function trendData(history, archerId, face, dist) {
  return (history || []).filter(h => h.status === 'zamknieta' && h.ends && h.ends.length && (h.archerId || null) === (archerId || null))
    .map(summary).filter(S => S.face === face && S.dist === dist && S.n > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}
function linfit(ys, xs) { // least squares
  const n = ys.length; xs = xs || ys.map((_, i) => i); const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0; return { a: my - b * mx, b };
}
function change(vals) { // early vs late
  const v = vals.filter(x => x != null); if (v.length < 2) return null;
  const k = v.length >= 6 ? 3 : 1, avg = a => a.reduce((s, x) => s + x, 0) / a.length;
  return { from: avg(v.slice(0, k)), to: avg(v.slice(-k)), k };
}
function trendChart(pts, x0, y0, w, h, o) {
  // pts: [{v, label, date}], o: {dec, zero, unit}
  const vals = pts.map(p => p.v).filter(v => v != null); if (!vals.length) return '';
  let lo = o.zero ? 0 : Math.min(...vals), hi = Math.max(...vals);
  if (!o.zero) { const pad = Math.max((hi - lo) * 0.25, o.minPad || 0.5); lo = Math.max(o.floor != null ? o.floor : -Infinity, lo - pad); hi = Math.min(o.ceil != null ? o.ceil : Infinity, hi + pad); }
  else hi = hi * 1.2 || 1;
  const step = niceStep((hi - lo) / 3); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step - 1e-9) * step;
  const padL = 36, padB = 26, n = pts.length, inset = 14;
  const ts = pts.map(p => p.t), t0 = Math.min(...ts), t1 = Math.max(...ts), span = t1 - t0;
  const X = i => x0 + padL + inset + (span > 0 ? (pts[i].t - t0) / span : 0.5) * (w - padL - 2 * inset), Y = v => y0 + (h - padB) * (1 - (v - lo) / (hi - lo));
  let s = '';
  for (let t = lo; t <= hi + 1e-9; t += step) s += `<line x1="${x0 + padL}" x2="${x0 + w}" y1="${Y(t)}" y2="${Y(t)}" stroke="${T.line}"/>` + txt(x0 + padL - 6, Y(t) + 4, nf(t, step < 1 ? 1 : 0), { size: 12, fill: T.mut, anchor: 'end' });
  const idx = pts.map((p, i) => [p, i]).filter(([p]) => p.v != null);
  if (idx.length >= 3) { // trend line
    const xs = idx.map(([p]) => (p.t - t0) / 864e5), f = linfit(idx.map(([p]) => p.v), xs), i0 = idx[0][1], i1 = idx[idx.length - 1][1];
    const ya = f.a + f.b * xs[0], yb = f.a + f.b * xs[xs.length - 1];
    s += `<path d="M${X(i0)} ${Y(ya)}L${X(i1)} ${Y(yb)}" stroke="${T.acc}" stroke-width="1.8" stroke-dasharray="6 5" fill="none"/>`;
  }
  if (idx.length > 1) s += `<path d="${idx.map(([p, i], k) => (k ? 'L' : 'M') + X(i) + ' ' + Y(p.v)).join('')}" fill="none" stroke="${T.s1}" stroke-width="2"/>`;
  for (const [p, i] of idx) s += `<circle cx="${X(i)}" cy="${Y(p.v)}" r="4.5" fill="${T.s1}" stroke="${T.panel}" stroke-width="2"><title>${p.label}: ${nf(p.v, o.dec)}${o.unit || ''}</title></circle>`;
  // direct labels: first and last only
  const lab = [idx[0], idx[idx.length - 1]].filter((x, k, a) => k === 0 || x !== a[0]);
  for (const [p, i] of lab) s += txt(X(i), Y(p.v) - 10, nf(p.v, o.dec), { size: 12.5, fill: T.fg2, anchor: 'middle' });
  // x labels: first, last and a few in between
  let lastX = -1e9; const lastI = n - 1;
  pts.forEach((p, i) => { const x = X(i); if (i === lastI ? x - lastX >= 38 || true : x - lastX >= 44 && X(lastI) - x >= 44) { if (i === lastI && x - lastX < 38) return; s += txt(x, y0 + h - 6, p.short, { size: 11.5, fill: T.mut, anchor: 'middle' }); lastX = x; } });
  return s;
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

function trendSVG(list, meta) {
  const W = 480, M = 16, IW = W - 2 * M; let b = '', y = 0;
  const panel = (yy, hh) => { b += `<rect x="${M}" y="${yy}" width="${IW}" height="${hh}" rx="12" fill="${T.panel}"/>`; };
  const d0 = list.length ? new Date(list[0].date) : null, d1 = list.length ? new Date(list[list.length - 1].date) : null;
  const dd = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  b += txt(M, 40, 'Postępy', { size: 24, w: 700 });
  b += txt(M, 66, `${meta.archer || ''}${meta.bow ? ' · ' + meta.bow : ''}`, { size: 16, fill: T.fg2 });
  b += txt(M, 88, `${FACE_NAME[meta.face] || meta.face} · ${nf(meta.dist)} m · ${list.length} ${list.length === 1 ? 'sesja' : list.length < 5 ? 'sesje' : 'sesji'}${d0 ? ` · ${dd(d0)}${dd(d1) !== dd(d0) ? '–' + dd(d1) : ''}` : ''}`, { size: 14, fill: T.mut });
  y = 104;
  if (list.length < 2) {
    panel(y, 70); b += txt(M + 14, y + 30, 'Za mało danych do trendu.', { size: 16, w: 600 }) + txt(M + 14, y + 52, 'Potrzebne co najmniej 2 zamknięte sesje z tym licem i dystansem.', { size: 13, fill: T.fg2 });
    y += 90;
  } else {
    const pts = list.map(S => { const d = new Date(S.date); return { S, t: d.getTime(), label: dd(d), short: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}` }; });
    const avg = pts.map(p => Object.assign({ v: p.S.avg }, p)), d90 = pts.map(p => Object.assign({ v: p.S.d90 != null ? p.S.d90 : null }, p));
    const off = pts.map(p => Object.assign({ v: p.S.mx != null ? Math.hypot(p.S.mx, p.S.my) : null }, p));
    // tiles: change early -> late
    const cA = change(avg.map(p => p.v)), cD = change(d90.map(p => p.v)), cO = change(off.map(p => p.v));
    const kLbl = c => c && c.k > 1 ? `śr. ${c.k} pierwszych → ${c.k} ostatnich` : 'pierwsza → ostatnia';
    const tiles = [
      ['Średnia/strzałę', cA ? `${nf(cA.from, 2)} → ${nf(cA.to, 2)}` : '—', cA ? `${cA.to >= cA.from ? '▲' : '▼'} ${nf(Math.abs(cA.to - cA.from), 2)} ${cA.to >= cA.from ? 'lepiej' : 'gorzej'}` : ''],
      ['Grupa 90% [mm]', cD ? `${nf(cD.from)} → ${nf(cD.to)}` : '—', cD ? `${cD.to <= cD.from ? '▼' : '▲'} ${nf(Math.abs(cD.to - cD.from))} mm ${cD.to <= cD.from ? 'ciaśniej' : 'szerzej'}` : ''],
      ['Środek grupy [mm]', cO ? `${nf(cO.from)} → ${nf(cO.to)}` : '—', cO ? `od środka tarczy` : '']
    ];
    const gap = 8, tw = (IW - 2 * gap) / 3, th = 78;
    tiles.forEach(([k, v, sub], i) => {
      const x = M + i * (tw + gap);
      b += `<rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="10" fill="${T.panel}"/>`;
      b += txt(x + 10, y + 20, k, { size: 12.5, fill: T.mut }) + txt(x + 10, y + 47, v, { size: 18, w: 700 }) + txt(x + 10, y + 67, sub, { size: 11.5, fill: T.fg2 });
    });
    b += txt(M, y + th + 18, kLbl(cA || cD), { size: 11.5, fill: T.mut });
    y += th + 30;
    const chH = 150;
    const charts = [
      ['Średnia na strzałę', 'wyżej = lepiej', avg, { dec: 2, floor: 0, ceil: 10, minPad: 0.3 }],
      ['Średnica grupy 90% [mm]', 'niżej = lepiej', d90, { dec: 0, zero: true, unit: ' mm' }],
      ['Środek grupy od środka tarczy [mm]', 'celownik', off, { dec: 0, zero: true, unit: ' mm' }]
    ];
    for (const [title, note, data, o] of charts) {
      panel(y, chH + 40);
      b += txt(M + 12, y + 24, title, { size: 15, w: 650 }) + txt(W - M - 12, y + 24, note, { size: 12.5, fill: T.mut, anchor: 'end' });
      b += trendChart(data, M + 4, y + 36, IW - 16, chH, o);
      y += chH + 40 + 12;
    }
    b += `<path d="M${M + 4} ${y + 4}h22" stroke="${T.s1}" stroke-width="2"/><circle cx="${M + 15}" cy="${y + 4}" r="4.5" fill="${T.s1}" stroke="${T.bg}" stroke-width="2"/>` + txt(M + 32, y + 9, 'sesja', { size: 13, fill: T.fg2 });
    if (list.length >= 3) b += `<path d="M${M + 90} ${y + 4}h22" stroke="${T.acc}" stroke-width="1.8" stroke-dasharray="6 5"/>` + txt(M + 118, y + 9, 'kierunek zmian (trend liniowy)', { size: 13, fill: T.fg2 });
    y += 26;
  }
  b += txt(M, y + 10, 'ArcheryNote · AR & Claude (Anthropic)', { size: 11.5, fill: '#56616b' });
  const H = y + 26;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="${T.bg}"/>${b}</svg>`;
}

const API = { group, summary, comparable, cardSVG, pct, offsetText, trendCombos, trendData, trendSVG };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.ANStats = API;
})(typeof window !== 'undefined' ? window : globalThis);
