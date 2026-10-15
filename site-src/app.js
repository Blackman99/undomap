import { grade, fmtBytes } from "../src/browser.ts";
import { SAMPLES } from "./samples.js";
import { VB_W, VB_H, GW, GH, terrain, quantile, floodPath, contourPaths, pickPoints, toGrid, el } from "./map.js";

const $ = (s) => document.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const svg = $("#map");
const plural = (n, w) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ease = (t) => 1 - Math.pow(1 - t, 3);

// ---------- static map furniture ----------
const defs = el("defs", {}, svg);
defs.innerHTML = `
  <pattern id="hatch-ve" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="rgba(212,96,10,.3)"/><line x1="0" y1="0" x2="0" y2="9" stroke="#d4600a" stroke-width="2.2" stroke-opacity=".9"/></pattern>
  <pattern id="dots-ae" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="rgba(184,150,46,.22)"/><circle cx="4.5" cy="4.5" r="1.4" fill="#b8962e"/></pattern>`;
const gContours = el("g", { "aria-hidden": "true" }, svg);
const gAE = el("path", { class: "flood-ae", d: "" }, svg);
const gVE = el("path", { class: "flood-ve", d: "" }, svg);
const gRiver = el("g", { "aria-hidden": "true" }, svg);
const gFurn = el("g", { "aria-hidden": "true" }, svg);
const gBm = el("g", {}, svg);

// neatline ticks, north arrow
for (let i = 1; i < 16; i++) {
  const x = (VB_W / 16) * i;
  el("line", { class: "tick", x1: x, y1: 0, x2: x, y2: i % 4 ? 6 : 12 }, gFurn);
  el("line", { class: "tick", x1: x, y1: VB_H, x2: x, y2: VB_H - (i % 4 ? 6 : 12) }, gFurn);
}
for (let i = 1; i < 9; i++) {
  const y = (VB_H / 9) * i;
  el("line", { class: "tick", x1: 0, y1: y, x2: i % 3 ? 6 : 12, y2: y }, gFurn);
  el("line", { class: "tick", x1: VB_W, y1: y, x2: VB_W - (i % 3 ? 6 : 12), y2: y }, gFurn);
}
// visible slice of the sheet in viewBox units; the share image (?og) crops top and bottom
const view = { x0: 0, x1: VB_W, y0: 0, y1: VB_H };
const north = el("g", { class: "north", transform: `translate(${VB_W - 62},86)` }, gFurn);
el("path", { d: "M0 -30 L9 12 L0 5 L-9 12 Z", fill: "#14232e" }, north);
el("path", { d: "M0 -30 L0 5 L-9 12 Z", fill: "#cfdce3", stroke: "#14232e", "stroke-width": 1.2 }, north);
el("text", { x: 0, y: 34, "text-anchor": "middle" }, north).textContent = "N";
const scale = el("g", { class: "scalebar", transform: `translate(34,${VB_H - 72})` }, gFurn);
function placeFurniture() {
  north.setAttribute("transform", `translate(${view.x1 - 62},${view.y0 + 86})`);
  scale.setAttribute("transform", `translate(${view.x0 + 34},${view.y1 - 72})`);
}

// grid column of section A–A′: left third of whatever part of the sheet is visible
const sectionCol = () => Math.round((view.x0 + (view.x1 - view.x0) * 0.29) / S);

// ---------- state ----------
let current = null; // { report, t, pts }
let anim = 0;
const tag = document.createElement("div");
tag.className = "tag";
tag.setAttribute("role", "tooltip");
document.body.appendChild(tag);

function shares(r) {
  const tot = r.totals.VE.bytes + r.totals.AE.bytes + r.totals.X.bytes || 1;
  let ve = r.totals.VE.bytes / tot, ae = r.totals.AE.bytes / tot;
  // keep tiny-but-real losses visible; never drown the whole sheet
  const dry = r.totals.X.files ? 0.14 : 0.04; // the high ground stays visible when anything is tracked
  if (r.totals.VE.places) ve = Math.min(0.7, Math.max(0.05, ve));
  if (r.totals.AE.places) ae = Math.min(1 - dry - ve, Math.max(0.06, ae));
  return { ve: r.totals.VE.places ? ve : 0, ae: r.totals.AE.places ? ae : 0, tot };
}

const S = VB_W / GW; // viewBox units per grid cell (square cells)
const viewRows = () => [Math.ceil(view.y0 / S) + 6, Math.floor(view.y1 / S) - 6];
const viewCols = () => [Math.ceil(view.x0 / S) + 6, Math.floor(view.x1 / S) - 8];
// Fit the visible window to the screen: the full 2:1 sheet on wide screens, a centred 5:4 window on phones
// (benchmarks and labels are placed inside the window, so nothing important is cut off).
function fitView() {
  const og = document.body.classList.contains("og");
  const fr = svg.getBoundingClientRect();
  const narrow = fr.width < 640;
  // share image: the frame's own aspect (the map column of the card)
  const w = og ? Math.min(VB_W, Math.round((VB_H * fr.width) / fr.height)) : narrow ? Math.round(VB_H * 1.25) : VB_W;
  view.x0 = Math.round((VB_W - w) / 2);
  view.x1 = view.x0 + w;
  view.y0 = 0;
  view.y1 = VB_H;
  svg.setAttribute("viewBox", `${view.x0} 0 ${w} ${VB_H}`);
  // keep map lettering about 13px on screen whatever the sheet's scale
  const px = svg.getBoundingClientRect().width / w;
  labelK = Math.min(2.4, Math.max(1, 13 / (15 * px)));
  svg.style.setProperty("--k", labelK.toFixed(3));
  document.body.classList.toggle("big-labels", labelK > 1.25);
}
let labelK = 1;

function drawScale(r, s) {
  scale.innerHTML = "";
  const W = 300;
  el("rect", { x: 0, y: 0, width: W, height: 9, fill: "#cfdce3", stroke: "#14232e", "stroke-width": 1.2 }, scale);
  el("rect", { x: 0, y: 0, width: W * s.ve, height: 9, fill: "url(#hatch-ve)" }, scale);
  el("rect", { x: W * s.ve, y: 0, width: W * s.ae, height: 9, fill: "url(#dots-ae)" }, scale);
  for (const q of [0, 0.25, 0.5, 0.75, 1]) {
    el("line", { x1: W * q, y1: -4, x2: W * q, y2: 13, stroke: "#14232e", "stroke-width": 1 }, scale);
    el("text", { x: W * q, y: 28, "text-anchor": "middle" }, scale).textContent = q === 0 ? "0" : `${q * 100}%`;
  }
  el("text", { x: 0, y: -12 }, scale).textContent = `SCALE OF LOSS · flood area ∝ share of ${fmtBytes(s.tot)} mapped`;
}

function benchmarkLabel(f) {
  const p = f.kind === "symlink-escape" ? `${f.path} → ${f.target}` : f.path === "*" ? "./* loose files" : f.path.replace(/^\.\//, "") || "./";
  if (f.kind === "tracked") return { a: `${fmtBytes(f.bytes)} tracked`, b: `${f.path === "./" ? "" : f.path + " "}${plural(f.files, "file")}` };
  return { a: f.kind === "unpushed" ? `${f.unpushed} unpushed` : fmtBytes(f.bytes), b: p.length > 30 ? "…" + p.slice(-29) : p };
}

function placeBenchmarks(r, t, lv, features) {
  gBm.innerHTML = "";
  const taken = features.map((b) => [(b.x0 + b.x1) / 2 / S, (b.y0 + b.y1) / 2 / S]);
  const groups = [
    ["VE", r.findings.filter((f) => f.zone === "VE").slice(0, 7), t.min - 1, lv.ve],
    ["AE", r.findings.filter((f) => f.zone === "AE").slice(0, 4), lv.ve, lv.ae],
    ["X", r.findings.filter((f) => f.zone === "X").slice(0, 2), lv.ae, t.max + 1],
  ];
  const boxes = [...features];
  const out = [];
  let n = 0;
  for (const [zone, fs, lo, hi] of groups) {
    if (!fs.length) continue;
    const ridgeBox = features[features.length - 1];
    const pts = pickPoints(t, lo, hi, fs.length, toGrid({ ...ridgeBox, y0: ridgeBox.y0 - 30, y1: ridgeBox.y1 + 24 }), taken, viewRows(), viewCols());
    pts.forEach((p, i) => {
      taken.push([p.x / S, p.y / S]);
      const f = fs[i];
      n++;
      const g = el("g", { class: `bm ${zone.toLowerCase()} wait`, transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`, tabindex: 0, role: "button", "aria-label": `${zone} ${fmtBytes(f.bytes)} ${f.path}: ${f.why}` }, gBm);
      g.dataset.i = String(r.findings.indexOf(f));
      el("circle", { class: "ring", r: 6 }, g);
      el("path", { d: "M0 -13 L11.5 7 L-11.5 7 Z" }, g);
      el("circle", { class: "disc", cy: 1, r: 3 }, g);
      const lab = benchmarkLabel(f);
      // phones show one bigger label line (see .narrow-map in style.css), so boxes scale with it
      const k = labelK > 1.25 ? labelK : 1;
      const w = (k > 1 ? `BM ${n} · ${lab.a}`.length * 9.1 : Math.max(`BM ${n} · ${lab.a}`.length * 9.1, lab.b.length * 7.9)) * k + 10;
      const bh = k > 1 ? 34 : 36;
      // try right, left, below, above
      const opts = [[18, -2, "start"], [-18, -2, "end"], [-w / 2, 34, "start"], [-w / 2, -34, "start"]].map(([x, y, a]) => [x * k, y * k, a]);
      let pick = null;
      for (const o of [...opts, [26 * k, -16 * k, "start"], [-26 * k, -16 * k, "end"], [26 * k, 14 * k, "start"], [-26 * k, 14 * k, "end"]]) {
        const x0 = p.x + (o[2] === "end" ? o[0] - w : o[0]), y0 = p.y + o[1] - 16 * k;
        const box = { x0, y0, x1: x0 + w, y1: y0 + bh * (k > 1 ? 1.2 : 1) };
        const inside = box.x0 > view.x0 + 8 && box.x1 < view.x1 - 8 && box.y0 > view.y0 + 8 && box.y1 < view.y1 - 8;
        const clash = boxes.some((q) => !(box.x1 < q.x0 || box.x0 > q.x1 || box.y1 < q.y0 || box.y0 > q.y1));
        if (inside && !clash) {
          pick = o;
          boxes.push(box);
          break;
        }
      }
      // no room: the triangle stays, the survey tag (hover/focus) carries the label
      if (pick) {
        const tx = el("text", { x: pick[0], y: pick[1], "text-anchor": pick[2] }, g);
        const t1 = el("tspan", { class: "lab1 halo", x: pick[0] }, tx);
        t1.textContent = `BM ${n} · ${lab.a}`;
        const t2 = el("tspan", { class: "lab2 halo", x: pick[0], dy: 17 }, tx);
        t2.textContent = lab.b;
      } else {
        const tx = el("text", { x: 0, y: -18, "text-anchor": "middle" }, g);
        el("tspan", { class: "lab1 halo" }, tx).textContent = String(n);
      }
      out.push({ g, h: p.h, f, zone });
    });
  }
  return out;
}

function drawRiver(t) {
  gRiver.innerHTML = "";
  const d = "M" + t.river.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L");
  const path = el("path", { class: "river", d, id: "river" }, gRiver);
  const len = path.getTotalLength();
  // map furniture first, so the river names can steer clear of it
  const sx = sectionCol() * S;
  const boxes = [
    { x0: view.x1 - 110, x1: view.x1, y0: view.y0 + 30, y1: view.y0 + 140 }, // north arrow
    { x0: view.x0 + 20, x1: view.x0 + 360, y0: view.y1 - 100, y1: view.y1 - 30 }, // scale bar
    { x0: sx - 6, x1: sx + 30, y0: view.y0 + 20, y1: view.y0 + 60 },
    { x0: sx - 6, x1: sx + 30, y0: view.y1 - 60, y1: view.y1 - 20 },
  ];
  const secLine = { x0: sx - 14, x1: sx + 14, y0: view.y0, y1: view.y1 }; // river names don't cross section A–A′
  const hit = (b) => [...boxes, secLine].some((q) => !(b.x1 < q.x0 || b.x0 > q.x1 || b.y1 < q.y0 || b.y0 > q.y1));
  let from = 0;
  for (const text of ["rm  −rf  creek", "git  clean  −fdx"]) {
    for (let at = from; at < 0.95; at += 0.02) {
      const a = path.getPointAtLength(len * at), b = path.getPointAtLength(Math.min(len, len * at + 190));
      const box = { x0: Math.min(a.x, b.x) - 10, x1: Math.max(a.x, b.x) + 10, y0: Math.min(a.y, b.y) - 34, y1: Math.max(a.y, b.y) + 8 };
      if (box.x0 < view.x0 + 12 || box.x1 > view.x1 - 12 || hit(box)) continue;
      const tx = el("text", { class: "feature", dy: -9 }, gRiver);
      el("textPath", { href: "#river", startOffset: `${(at * 100).toFixed(1)}%` }, tx).textContent = text;
      boxes.push(box);
      from = at + 0.3 * ((view.x1 - view.x0) / VB_W);
      break;
    }
  }
  // the ridge label sits on the true summit of this terrain
  const [r0, r1] = viewRows();
  const kk = labelK > 1.25 ? labelK : 1;
  const half = 150 * kk; // half the width of "GIT CHECKOUT HEIGHTS" at this lettering size
  let best = -Infinity, bx = 20, by = 12;
  for (let y = r0 + 2; y < r1 + 2; y++)
    for (let x = Math.ceil((view.x0 + half) / S) + 2; x < Math.floor((view.x1 - half) / S) - 2; x++) {
      if (Math.abs(x * S - sectionCol() * S) < half + 16) continue; // keep the name off the section line
      if (x > view.x1 / S - 30 && y < r0 + 12) continue; // north arrow
      const h = t.v[y * GW + x];
      if (h > best) (best = h), (bx = x), (by = y);
    }
  const rg = el("text", { class: "ridge", x: bx * S, y: by * S + 6, "text-anchor": "middle" }, gRiver);
  rg.textContent = "GIT CHECKOUT HEIGHTS";
  boxes.push({ x0: bx * S - half, x1: bx * S + half, y0: by * S - 14 * kk, y1: by * S + 12 * kk });
  return boxes;
}

function drawContours(t) {
  gContours.innerHTML = "";
  contourPaths(t).forEach((c, i) => {
    const p = el("path", { class: `contour${c.index ? " index" : ""}${reduce ? "" : " draw"}`, d: c.d, pathLength: 1 }, gContours);
    if (!reduce) p.style.animationDelay = `${(i * 0.035).toFixed(3)}s`;
  });
}

function setReadout(r, bytes, places) {
  const ro = $(".readout");
  ro.classList.toggle("none", r.totals.VE.places === 0);
  $("#ve-bytes").textContent = fmtBytes(bytes);
  $("#ve-rest").textContent = r.totals.VE.places === 0 ? "— nothing here your agent can erase for good" : `across ${plural(places, "place")} your agent can erase forever`;
}

function render(report, seed, { instant = reduce } = {}) {
  cancelAnimationFrame(anim);
  const t = terrain(seed);
  const s = shares(report);
  const lv = { ve: s.ve ? quantile(t, s.ve) : t.min - 1, ae: s.ae ? quantile(t, s.ve + s.ae) : s.ve ? quantile(t, s.ve) : t.min - 1 };
  fitView();
  placeFurniture();
  drawContours(t);
  const features = drawRiver(t);
  drawScale(report, s);
  const bms = placeBenchmarks(report, t, lv, features);
  drawProfile(t, lv, report);
  current = { report, t, bms, seed };
  renderRegister(report);
  const flash = (b) => {
    b.g.classList.remove("wait");
    if (!instant) b.g.classList.add("flash");
  };
  if (instant) {
    gVE.setAttribute("d", floodPath(t, lv.ve, true));
    gAE.setAttribute("d", floodPath(t, lv.ae, true));
    bms.forEach(flash);
    setReadout(report, report.totals.VE.bytes, report.totals.VE.places);
    return;
  }
  gVE.setAttribute("d", "");
  gAE.setAttribute("d", "");
  setReadout(report, 0, 0);
  $("#ve-rest").textContent = "surveying…"; // until the water starts rising
  const t0 = performance.now() + 650;
  const DVE = 1700, DAE = 1100;
  const veB = bms.filter((b) => b.zone === "VE");
  const step = (now) => {
    const e = now - t0;
    if (e < 0) return (anim = requestAnimationFrame(step));
    const pv = Math.min(1, e / DVE);
    const levelVE = t.min + (lv.ve - t.min) * ease(pv);
    gVE.setAttribute("d", floodPath(t, levelVE, pv === 1));
    let bytes = 0, places = 0;
    for (const b of veB) if (b.h <= levelVE + 1e-9 && b.g.classList.contains("wait")) flash(b);
    for (const b of veB) if (!b.g.classList.contains("wait")) { bytes += b.f.bytes; places++; }
    // the readout climbs with the water, landing on the exact total
    if (pv === 1) { bytes = report.totals.VE.bytes; places = report.totals.VE.places; }
    else bytes = Math.max(bytes, report.totals.VE.bytes * ease(pv) * 0.97);
    setReadout(report, bytes, Math.max(places, Math.round(report.totals.VE.places * pv)));
    if (e > DVE) {
      const pa = Math.min(1, (e - DVE) / DAE);
      const levelAE = lv.ve + (lv.ae - lv.ve) * ease(pa);
      gAE.setAttribute("d", floodPath(t, Math.max(levelAE, lv.ve), pa === 1));
      for (const b of bms) if (b.zone === "AE" && b.h <= levelAE && b.g.classList.contains("wait")) flash(b);
      if (pa === 1) {
        for (const b of bms) if (b.g.classList.contains("wait")) flash(b);
        return;
      }
    }
    anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}

// ---------- Section A–A′ (a real cross-section of the current terrain) ----------
const prof = $("#profile");
const gSec = el("g", { "aria-hidden": "true" });
svg.insertBefore(gSec, gBm);
function drawProfile(t, lv, r) {
  prof.innerHTML = "";
  gSec.innerHTML = "";
  const col = sectionCol();
  const W = 1200, H = 300, top = 40, bot = 250;
  const hs = Array.from({ length: GH }, (_, y) => t.v[y * GW + col]);
  const lo = Math.min(...hs), hi = Math.max(...hs);
  const X = (y) => 40 + (y / (GH - 1)) * (W - 80);
  const Y = (h) => bot - ((h - lo) / (hi - lo || 1)) * (bot - top);
  const ground = hs.map((h, y) => `${X(y).toFixed(1)},${Y(h).toFixed(1)}`).join(" L");
  const water = (level, cls) => {
    if (level <= lo) return;
    const poly = `M${X(0)},${Y(level)} ` + hs.map((h, y) => `L${X(y).toFixed(1)},${Y(Math.min(h, level)).toFixed(1)}`).join(" ") + ` L${X(GH - 1)},${Y(level)} Z`;
    el("path", { class: cls, d: poly }, prof);
    el("line", { class: "lvl", x1: 40, x2: W - 40, y1: Y(level), y2: Y(level), stroke: cls === "w-ve" ? "#d4600a" : "#b8962e" }, prof);
  };
  water(Math.min(lv.ae, hi), "w-ae");
  water(Math.min(lv.ve, hi), "w-ve");
  el("path", { class: "ground", d: `M${X(0)},${H - 14} L${ground} L${X(GH - 1)},${H - 14} Z` }, prof);
  el("text", { x: 22, y: H - 20, class: "big" }, prof).textContent = "A";
  el("text", { x: W - 34, y: H - 20, class: "big" }, prof).textContent = "A′";
  if (r.totals.VE.places && lv.ve > lo) el("text", { x: W - 44, y: Y(Math.min(lv.ve, hi)) - 6, "text-anchor": "end" }, prof).textContent = `ZONE VE · ${fmtBytes(r.totals.VE.bytes)} · no way back`;
  if (r.totals.AE.places && lv.ae > lv.ve) el("text", { x: W - 44, y: Y(Math.min(lv.ae, hi)) - 6, "text-anchor": "end" }, prof).textContent = `ZONE AE · ${fmtBytes(r.totals.AE.bytes)} · slow undo`;
  // survey stations along the section
  ["BM 1 git status", "BM 2 regenerable?", "BM 3 remotes", "BM 4 snapshots"].forEach((label, i) => {
    const y = Math.round(GH * (0.13 + i * 0.245));
    const g = el("g", { class: "stn", transform: `translate(${X(y)},${Y(hs[y]) - 4})` }, prof);
    el("path", { d: "M0 -12 L10 5 L-10 5 Z" }, g);
    el("text", { x: 0, y: -20, "text-anchor": "middle" }, g).textContent = label;
  });
  // the section line on the map itself
  const x = col * S + S / 2;
  el("line", { x1: x, x2: x, y1: view.y0 + 24, y2: view.y1 - 24, stroke: "#14232e", "stroke-width": 1.4, "stroke-dasharray": "10 6 2 6", opacity: 0.7 }, gSec);
  el("text", { x: x + 8, y: view.y0 + 40, class: "feature", style: "font-style:normal;font-weight:600;letter-spacing:0" }, gSec).textContent = "A";
  el("text", { x: x + 8, y: view.y1 - 30, class: "feature", style: "font-style:normal;font-weight:600;letter-spacing:0" }, gSec).textContent = "A′";
}

// ---------- register below the map ----------
function copyBtn(text) {
  return `<button type="button" data-copy="${esc(text)}">copy</button>`;
}
function renderRegister(r) {
  const ve = r.findings.filter((f) => f.zone === "VE");
  const ae = r.findings.filter((f) => f.zone === "AE");
  const max = ve[0]?.bytes || 1;
  const bmIndex = new Map(current.bms.map((b, i) => [b.f, i + 1]));
  $("#rows-ve").innerHTML = ve.length
    ? ve
        .map((f, i) => {
          const n = bmIndex.get(f);
          const p = f.kind === "symlink-escape" ? `${f.path} → ${f.target}` : f.path === "*" ? "./* (loose files)" : f.path.replace(/^\.\/(?=.)/, "");
          return `<li data-i="${r.findings.indexOf(f)}"><span class="bmn">${n ? "BM " + n : "VE " + (i + 1)}</span><span class="by">${fmtBytes(f.bytes)}${f.capped ? "+" : ""}<i class="bar" style="width:${Math.max(3, (f.bytes / max) * 100).toFixed(1)}%"></i></span><span class="p">${esc(p)}<span class="why">${esc(f.why)}${f.files > 1 ? " · " + plural(f.files, "file") : ""}</span></span><span class="fx">${f.fix ? esc(cap(f.fix.say)) + (f.fix.run ? `<code><span class="c">$ ${esc(f.fix.run)}</span>${copyBtn(f.fix.run)}</code>` : "") : ""}</span></li>`;
        })
        .join("")
    : `<li><span class="empty"><b>0 B</b> in Zone VE — nothing here your agent can erase for good.</span></li>`;
  $("#reg-sub").textContent = ve.length
    ? `${fmtBytes(r.totals.VE.bytes)} across ${plural(r.totals.VE.places, "place")} in ${r.root}. Biggest first, each with the cheapest fix that actually protects it.`
    : `Nothing in the velocity zone at ${r.root}.`;
  $("#ae-sum").textContent = ae.length ? `${fmtBytes(r.totals.AE.bytes)} across ${plural(ae.length, "place")}` : "nothing";
  $("#rows-ae").innerHTML = ae
    .slice(0, 8)
    .map((f) => `<li data-i="${r.findings.indexOf(f)}"><span class="bmn">${bmIndex.get(f) ? "BM " + bmIndex.get(f) : "AE"}</span><span class="by">${f.kind === "unpushed" ? "—" : fmtBytes(f.bytes)}</span><span class="p">${esc(f.path.replace(/^\.\/(?=.)/, ""))}<span class="why">${esc(f.why)}</span></span></li>`)
    .join("");
  $("#x-sum").textContent = r.totals.X.files ? `${fmtBytes(r.totals.X.bytes)} · ${plural(r.totals.X.files, "tracked file")} — git checkout / git restore` : "no clean tracked files";
  $("#probes").innerHTML = "probes&nbsp; " + r.probes.map((p) => `${esc(p.name)} <span class="${p.status === "ok" ? (p.counts ? "ok" : "") : p.status === "absent" ? "no" : ""}">${p.status === "ok" ? (p.counts ? "✓" : "~") : p.status === "absent" ? "✗" : "?"}</span> ${esc(p.detail)}`).join(" &nbsp;·&nbsp; ");
}

// ---------- hover / focus survey tag ----------
function showTag(g, x, y) {
  const f = current.report.findings[Number(g.dataset.i)];
  if (!f) return;
  tag.innerHTML = `<span class="z ${f.zone}">ZONE ${f.zone}</span><b>${esc(fmtBytes(f.bytes))}</b> · ${esc(f.path)}<br>${esc(f.why)}${f.fix ? `<br><i>${esc(cap(f.fix.say))}</i>${f.fix.run ? `<code>$ ${esc(f.fix.run)}</code>` : ""}` : ""}`;
  const w = 360;
  tag.style.left = `${Math.min(innerWidth - w - 12, x + 16)}px`;
  tag.style.top = `${Math.max(8, y - 20)}px`;
  tag.classList.add("on");
  document.querySelectorAll(`.rows li[data-i="${g.dataset.i}"]`).forEach((li) => li.classList.add("hot"));
}
function hideTag() {
  tag.classList.remove("on");
  document.querySelectorAll(".rows li.hot").forEach((li) => li.classList.remove("hot"));
}
gBm.addEventListener("pointerover", (e) => {
  const g = e.target.closest(".bm");
  if (g) showTag(g, e.clientX, e.clientY);
});
gBm.addEventListener("pointerout", hideTag);
gBm.addEventListener("focusin", (e) => {
  const g = e.target.closest(".bm");
  if (g) {
    const b = g.getBoundingClientRect();
    showTag(g, b.right, b.top);
  }
});
gBm.addEventListener("focusout", hideTag);
document.addEventListener("pointerover", (e) => {
  const li = e.target.closest?.(".rows li[data-i]");
  document.querySelectorAll("#map .bm.hot").forEach((g) => g.classList.remove("hot"));
  if (li) document.querySelector(`#map .bm[data-i="${li.dataset.i}"]`)?.classList.add("hot");
});

// ---------- copy buttons ----------
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-copy]");
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    const was = b.textContent;
    b.textContent = "copied";
    b.classList.add("ok");
    setTimeout(() => ((b.textContent = was), b.classList.remove("ok")), 1400);
  } catch {
    b.textContent = "select";
  }
});

// ---------- sites ----------
const panels = SAMPLES.map((s) => ({ ...s, report: grade(s.inv, { config: s.config }) }));
const sites = $("#sites");
function select(i, opts) {
  const s = panels[i];
  [...sites.children].forEach((b, j) => b.setAttribute("aria-selected", String(j === i)));
  document.querySelectorAll("[data-panel]").forEach((n) => (n.textContent = String(i + 1).padStart(2, "0")));
  $("[data-panel-kind]").textContent = `Survey panel ${String(i + 1).padStart(2, "0")}`;
  $("#root").textContent = s.report.root;
  $("#story").textContent = s.story + " ";
  const src = $("#story-src");
  src.textContent = s.source ? `Source: ${s.source.text}` : "";
  src.href = s.source?.href ?? "#";
  render(s.report, s.seed, opts);
}
panels.forEach((s, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("role", "tab");
  b.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span>${esc(s.label)}`;
  b.addEventListener("click", () => select(i));
  sites.appendChild(b);
});
document.querySelectorAll("[data-panels]").forEach((n) => (n.textContent = String(panels.length).padStart(2, "0")));

// ---------- your own JSON ----------
function loadYours(text) {
  const err = $("#yours-err");
  err.textContent = "";
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    err.textContent = "That isn't JSON. Run undomap --json > undomap.json and drop that file.";
    return;
  }
  if (r?.tool !== "undomap" || !Array.isArray(r.findings) || !r.totals) {
    err.textContent = "This JSON isn't an undomap report (expected \"tool\": \"undomap\" with findings and totals).";
    return;
  }
  [...sites.children].forEach((b) => b.setAttribute("aria-selected", "false"));
  $("[data-panel-kind]").textContent = "Your survey";
  $("#root").textContent = r.root;
  $("#story").textContent = `Drawn from your undomap ${r.version} report of ${r.findings.length} places. Nothing left this tab.`;
  $("#story-src").textContent = "";
  let seed = 0;
  for (const c of String(r.root)) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  document.querySelector(".sheet").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  render(r, seed || 5);
}
$("#file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (f) loadYours(await f.text());
});
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add("over"))));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) loadYours(await f.text());
});
$("#paste-go").addEventListener("click", () => loadYours($("#paste").value));

// ---------- go ----------
const qs = new URLSearchParams(location.search);
if (qs.has("og")) {
  // share-image mode (scripts/make_assets.sh): the map and its collar, nothing else
  document.body.classList.add("og");
  // headless screenshots can lay out before the final viewport size; take the card size from the URL
  const ogH = Number(qs.get("h")) || innerHeight;
  document.documentElement.style.setProperty("--og-h", ogH + "px");
}
select(Number(qs.get("panel") ?? 0) || 0, { instant: reduce || qs.has("still") || qs.has("og") });
// Re-survey when the sheet changes size (window resize, fonts settling, share-image viewport):
// the visible window and the lettering scale depend on it.
let resizeT = 0, lastW = 0, lastH = 0;
new ResizeObserver(([e]) => {
  const { width, height } = e.contentRect;
  if (Math.abs(width - lastW) < 2 && Math.abs(height - lastH) < 2) return;
  const first = !lastW;
  lastW = width;
  lastH = height;
  if (first) return;
  clearTimeout(resizeT);
  resizeT = setTimeout(() => current && render(current.report, current.seed ?? 7, { instant: true }), 200);
}).observe($(".frame"));
// QA hook for headless checks (scripts/qa.sh): report horizontal overflow and the widest offender.
if (new URLSearchParams(location.search).has("qa")) {
  const cw = document.documentElement.clientWidth;
  let worst = null, max = cw;
  for (const n of document.querySelectorAll("body *")) {
    const r = n.getBoundingClientRect();
    if (r.width && r.right > max + 0.5 && getComputedStyle(n).position !== "fixed") (max = r.right), (worst = n);
  }
  const box = (q) => { const r = $(q)?.getBoundingClientRect(); return r ? [q, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(":") : q + ":none"; };
  document.body.dataset.rects = [".sheet", ".frame", "#map", ".collar", ".c-title", ".c-title h1"].map(box).join(" ") + " vb:" + svg.getAttribute("viewBox");
  document.body.dataset.overflow = String(document.documentElement.scrollWidth - cw) + (worst ? ` ${worst.tagName.toLowerCase()}.${worst.className?.baseVal ?? worst.className}` : "");
}
