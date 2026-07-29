// ============================================================
// ВЕКТОР: Ортонорма — движок (ревизия B)
// Математика = физика мира: корабль летает по векторам тяги,
// топливо = длина, зеркала отражают матрицами каждый кадр,
// тень = мост, кривой базис искажает всю картинку и управление.
// ============================================================
"use strict";

// ---------------- сохранение ----------------
const SAVE_KEY = "vektor-ortonorma-v2";
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
  catch (e) { return {}; }
}
const save = Object.assign({ unlocked: 0, stars: {}, journal: [], endlessBest: 0 }, loadSave());
function writeSave() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }

const $ = id => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");
const SC = 85, OX = cv.width / 2, OY = cv.height / 2;

// ---------------- глобальное состояние ----------------
let S = null;            // состояние текущего сектора
let G = { screen: "menu", level: 0, mode: "campaign", streak: 0, instant: false };

function newState(L) {
  const W = L.world;
  const B0 = W.core ? M.matFromCols(W.core.b1, W.core.b2) : [[1, 0], [0, 1]];
  S = {
    L, W,
    ship: { pos: W.ship.slice(), ang: 0 },
    plan: { legs: [], cur: null },
    fuelUsed: 0,
    flying: null, trail: [],
    B: B0.map(r => r.slice()), Binv: M.matInv(B0),
    Bfrom: null, Btarget: null, Banim: 1,
    basisStep: W.core ? 0 : 3,
    mirrors: (W.mirrors || []).map(m => ({ c: m.c.slice(), ang: m.ang, len: m.len })),
    beam: W.beam ? { v: W.beam.v0.slice() } : null,
    shadowOk: false, droneT: null, droneDone: false,
    laserSegs: [], powered: false,
    conv: { slots: [null, null, null], C: null, ranOnce: false },
    station: null,
    docked: false, lastLegLen: 0,
    objDone: {}, complete: false, hintsUsed: 0, hintLevel: 0,
    msg: null, msgT: 0,
    stars: makeStars(),
    dlg: L.intro ? L.intro.slice() : [], dlgI: 0,
    t: 0,
  };
  // станция финала: честная физика решает, где она стоит
  if (W.shield) {
    const dIn = M.normalize(M.sub(W.shield.c, W.laser.pos));
    const T = M.reflectionMatrix(W.shield.dir);
    S.station = { pos: M.add(W.shield.c, M.scale(2.9, M.matVec(T, dIn))), r: 0.32 };
  }
}

function makeStars() {
  const arr = [];
  for (let i = 0; i < 90; i++)
    arr.push({ x: Math.random() * cv.width, y: Math.random() * cv.height,
               r: Math.random() * 1.4 + 0.3, a: Math.random() * 0.5 + 0.2 });
  return arr;
}

// ---------------- координаты (через матрицу базиса B!) ----------------
function toScr(p) {
  const q = M.matVec(S.B, p);
  return { x: OX + q[0] * SC, y: OY - q[1] * SC };
}
function fromScr(x, y) {
  return M.matVec(S.Binv, [(x - OX) / SC, (OY - y) / SC]);
}

// ---------------- экраны ----------------
function show(name) {
  ["menu", "levels", "game"].forEach(s => $("scr-" + s).classList.toggle("hidden", s !== name));
  G.screen = name;
}

// ---------------- сообщения и диалог ----------------
function msg(text, good) { S.msg = { text, good }; S.msgT = 4; }
function irisShow() {
  const bar = $("iris");
  if (S.dlgI < S.dlg.length) {
    bar.classList.remove("hidden");
    $("iris-text").textContent = S.dlg[S.dlgI];
  } else bar.classList.add("hidden");
}
$("iris").addEventListener("click", () => { S.dlgI++; irisShow(); });

// ============================================================
// ИНСТРУМЕНТЫ (нижняя панель)
// ============================================================
function chainTail() {
  let p = S.ship.pos.slice();
  for (const l of S.plan.legs) p = M.add(p, l);
  return p;
}
function planTarget() {           // вектор, к которому применяются операции
  if (S.plan.cur && M.norm(S.plan.cur) > 1e-9) return "cur";
  if (S.plan.legs.length) return "last";
  return null;
}
function getTargetVec() {
  const t = planTarget();
  return t === "cur" ? S.plan.cur : (t === "last" ? S.plan.legs[S.plan.legs.length - 1] : null);
}
function setTargetVec(v) {
  const t = planTarget();
  if (t === "cur") S.plan.cur = v;
  else if (t === "last") S.plan.legs[S.plan.legs.length - 1] = v;
}

const TOOL_DEFS = {
  commit: { label: "＋ Добавить вектор", fn: () => {
    if (!S.plan.cur || M.norm(S.plan.cur) < 0.01) { msg("Сначала наведи стрелку!"); return; }
    S.plan.legs.push(S.plan.cur); S.plan.cur = null;
    msg("Вектор в плане. Наводи следующий — он пристроится к концу.");
  }},
  normalize: { label: "⚙ Нормализовать (v/|v|)", fn: () => {
    const v = getTargetVec();
    if (!v) { msg("Нет вектора: сначала наведи стрелку."); return; }
    if (M.norm(v) < 1e-9) { msg("Нулевой вектор нельзя нормализовать!"); return; }
    setTargetVec(M.normalize(v));
    msg("Разделил на длину: направление то же, длина ровно 1.");
  }},
  decompose: { label: "✂ Разложить: тень + ⊥", fn: () => {
    const v = getTargetVec();
    if (!v) { msg("Сначала наведи стрелку на цель."); return; }
    const e = S.W.field.e;
    const ten = M.project(v, e), perp = M.sub(v, ten);
    if (M.norm(ten) < 0.01 || M.norm(perp) < 0.01) {
      msg("Вектор уже целиком вдоль или поперёк поля — раскладывать нечего."); return;
    }
    if (planTarget() === "cur") S.plan.cur = null; else S.plan.legs.pop();
    S.plan.legs.push(ten, perp);
    msg("Разложено: сначала тень (вдоль поля), потом перпендикуляр (сквозь поле).");
  }},
  drone: { label: "🚚 Запустить дрон", fn: () => {
    if (!S.shadowOk) { msg("Мост не готов: тень должна быть длиной ровно " + S.W.rail.need + "."); return; }
    if (S.droneT == null && !S.droneDone) { S.droneT = 0; msg("Дрон пошёл по мосту!", true); }
  }},
  gs1: { label: "⚙ Нормализовать b1", fn: () => basisOp(1) },
  gs2: { label: "✂ Вычесть из b2 тень на e1", fn: () => basisOp(2) },
  gs3: { label: "⚙ Нормализовать b2", fn: () => basisOp(3) },
};

function nearCore() {
  return S.W.core && M.norm(M.sub(S.ship.pos, S.W.core.pos)) < 1.9;
}

let barSignature = "";
function updateBar() {
  // --- живые числа слева ---
  let html = "";
  const fuelStr = S.W.fuel == null ? "" :
    ` · топливо: <b>${f2(S.fuelUsed)} / ${f2(S.W.fuel)}</b>`;
  if (S.L.beamLevel) {
    const v = S.beam.v, d = M.dot(v, S.W.rail.e);
    html = `Балка: <b>[${f2(v[0])}, ${f2(v[1])}]</b> · тень v·e = ` +
      `<b class="${S.shadowOk ? "good" : ""}">${f2(d)}</b> (нужно ${S.W.rail.need})`;
  } else if (S.L.conveyorLevel) {
    html = `Программа щита: применяется к лучу <b>слева направо</b>. ` +
      (S.conv.C ? `Прошито.` : `Слоты пусты.`);
  } else {
    const v = S.plan.cur || (S.plan.legs.length ? S.plan.legs[S.plan.legs.length - 1] : null);
    if (v) {
      const n = M.norm(v);
      html = `Тяга: <b>[${f2(v[0])}, ${f2(v[1])}]</b> · длина √(${f2(v[0])}² + ${f2(v[1])}²) = <b>${f2(n)}</b>`;
      const total = planLen();
      if (S.plan.legs.length) html += ` · весь план: <b>${f2(total)}</b>`;
      if (S.W.fuel != null && S.fuelUsed + total > S.W.fuel + 1e-9)
        html += ` <span class="warn">— не хватит топлива!</span>`;
    } else html = "Потяни мышкой от корабля — появится вектор тяги.";
    html += fuelStr;
  }
  $("bar-info").innerHTML = html;

  // --- кнопки (пересобираем только при смене набора) ---
  const ctxTools = [];
  if (S.L.flight) ctxTools.push("launch", "reset");
  for (const t of S.L.tools) ctxTools.push(t);
  if (nearCore()) {
    if (S.basisStep === 0) ctxTools.push("gs1");
    if (S.basisStep === 1) ctxTools.push("gs2");
    if (S.basisStep === 2) ctxTools.push("gs3");
  }
  if (S.L.conveyorLevel) ctxTools.push("conveyor");
  const sig = ctxTools.join(",") + "|" + (S.flying ? 1 : 0);
  if (sig === barSignature) return;
  barSignature = sig;

  const box = $("bar-tools"); box.innerHTML = "";
  for (const t of ctxTools) {
    if (t === "launch") {
      const b = document.createElement("button");
      b.className = "go"; b.textContent = "▶ Тяга!"; b.disabled = !!S.flying;
      b.onclick = launch; box.appendChild(b);
    } else if (t === "reset") {
      const b = document.createElement("button");
      b.textContent = "↺"; b.title = "Заправиться и начать сектор заново";
      b.onclick = resetShip; box.appendChild(b);
    } else if (t === "conveyor") {
      buildConveyorBar(box);
    } else {
      const def = TOOL_DEFS[t];
      const b = document.createElement("button");
      b.textContent = def.label; b.onclick = () => { def.fn(); updateBar(); };
      box.appendChild(b);
    }
  }
}

function planLen() {
  let s = 0;
  for (const l of S.plan.legs) s += M.norm(l);
  if (S.plan.cur) s += M.norm(S.plan.cur);
  return s;
}

// ---------------- полёт ----------------
function launch() {
  if (S.flying) return;
  const legs = S.plan.legs.slice();
  if (S.plan.cur && M.norm(S.plan.cur) > 0.01) legs.push(S.plan.cur);
  if (!legs.length) { msg("Сначала наведи вектор тяги: потяни мышкой от корабля."); return; }
  const total = legs.reduce((s, l) => s + M.norm(l), 0);
  if (S.W.fuel != null && S.fuelUsed + total > S.W.fuel + 1e-9) {
    msg(`Не хватит топлива: план стоит ${f2(total)}, осталось ${f2(S.W.fuel - S.fuelUsed)}. Короче вектор!`);
    return;
  }
  S.flying = { legs, i: 0, left: M.norm(legs[0]) };
  S.plan = { legs: [], cur: null };
  updateBar();
}

function resetShip() {
  S.ship.pos = S.W.ship.slice();
  S.fuelUsed = 0; S.plan = { legs: [], cur: null };
  S.flying = null; S.trail = [];
  msg("Заправлен и возвращён на старт.", true);
  updateBar();
}

function stepFlight(dt) {
  const F = S.flying;
  if (!F) return;
  let budget = G.instant ? 1e9 : 6 * dt;                // скорость 6 ед/с
  while (budget > 0 && S.flying) {
    const leg = F.legs[F.i], legLen = M.norm(leg);
    const u = M.normalize(leg);
    const step = Math.min(0.045, F.left, budget);
    const next = M.add(S.ship.pos, M.scale(step, u));
    // столкновение с астероидом
    let crash = false;
    for (const a of (S.W.asteroids || [])) {
      if (M.norm(M.sub(next, a.pos)) < a.r + 0.2) { crash = true; break; }
    }
    if (crash) {
      S.flying = null;
      msg("💥 Столкновение! Двигатели погашены. Построй маршрут в обход.", false);
      break;
    }
    // силовое поле: внутри можно лететь только перпендикулярно e
    const fld = S.W.field;
    if (fld && next[1] > fld.y0 && next[1] < fld.y1 &&
        Math.abs(M.dot(u, M.normalize(fld.e))) > 0.05) {
      S.flying = null;
      msg("⚡ Поле оттолкнуло: внутри канала лететь можно только ПЕРПЕНДИКУЛЯРНО полю!", false);
      break;
    }
    S.ship.pos = next;
    S.ship.ang = Math.atan2(u[1], u[0]);
    S.fuelUsed += step;
    F.left -= step; budget -= step;
    if (!G.instant) S.trail.push({ p: next.slice(), a: 1 });
    if (F.left <= 1e-9) {
      F.i++;
      if (F.i >= F.legs.length) {         // полёт завершён
        const last = F.legs[F.legs.length - 1];
        S.lastLegLen = M.norm(last);
        S.lastLegDir = M.normalize(last);
        S.flying = null;
        landCheck();
      } else F.left = M.norm(F.legs[F.i]);
    }
  }
  updateBar();
}

function landCheck() {
  const d = S.W.dock;
  if (!d || S.docked) return;
  if (M.norm(M.sub(S.ship.pos, d.pos)) > d.r) return;
  if (d.needPower && !S.powered) { msg("Док обесточен: сначала направь луч в приёмник."); return; }
  if (d.needBasis && S.basisStep < 3) { msg("Док не принимает корабль: базис сектора не откалиброван!"); return; }
  if (d.arriveLen != null && Math.abs(S.lastLegLen - d.arriveLen) > 0.06) {
    msg(`Док отверг стыковку: импульс ${f2(S.lastLegLen)}, а нужен ровно ${f2(d.arriveLen)}. Нормализуй последний вектор!`);
    // мягкий отскок, чтобы можно было зайти заново
    S.ship.pos = M.sub(S.ship.pos, M.scale(1.2, S.lastLegDir || [1, 0]));
    return;
  }
  S.docked = true;
  msg("🛰 Стыковка успешна!", true);
}

// ---------------- базис (Грам-Шмидт у ядра) ----------------
function basisOp(step) {
  if (S.basisStep !== step - 1) return;
  const b1 = [S.B[0][0], S.B[1][0]], b2 = [S.B[0][1], S.B[1][1]];
  let n1 = b1, n2 = b2;
  if (step === 1) { n1 = M.normalize(b1); msg("b1 / |b1| — первая ось теперь единичная. Смотри на мир!", true); }
  if (step === 2) { n2 = M.subtractShadow(b2, b1); msg("Из b2 вычтена тень на e1 — перекос уходит!", true); }
  if (step === 3) { n2 = M.normalize(b2); msg("b2 / |b2| — базис ортонормирован. Сектор выпрямлен!", true); }
  S.Bfrom = S.B.map(r => r.slice());
  S.Btarget = M.matFromCols(n1, n2);
  S.Banim = 0;
  S.basisStep = step;
  updateBar();
}

function stepBasisAnim(dt) {
  if (S.Banim >= 1 || !S.Btarget) return;
  S.Banim = Math.min(1, S.Banim + (G.instant ? 1 : dt / 0.9));
  const k = S.Banim * S.Banim * (3 - 2 * S.Banim);       // плавность
  S.B = [0, 1].map(i => [0, 1].map(j =>
    S.Bfrom[i][j] + (S.Btarget[i][j] - S.Bfrom[i][j]) * k));
  S.Binv = M.matInv(S.B);
}

// ---------------- лазер ----------------
function u2(ang) { return [Math.cos(ang), Math.sin(ang)]; }
function cross2(a, b) { return a[0] * b[1] - a[1] * b[0]; }

function raySeg(p, d, a, b) {
  const r = M.sub(b, a), den = cross2(d, r);
  if (Math.abs(den) < 1e-12) return null;
  const ap = M.sub(a, p);
  const t = cross2(ap, r) / den, s = cross2(ap, d) / den;
  return (t > 1e-6 && s >= 0 && s <= 1) ? t : null;
}
function rayCircle(p, d, c, r) {
  const f = M.sub(p, c);
  const b = M.dot(f, d), cc = M.dot(f, f) - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 1e-6 ? t : null;
}

function traceLaser() {
  const W = S.W;
  if (!W.laser) { S.laserSegs = []; return; }
  let pos = W.laser.pos.slice();
  let dir = W.laser.dir ? M.normalize(W.laser.dir)
                        : M.normalize(M.sub(W.laser.dirTo, pos));
  const segs = [];
  let powered = false;
  for (let bounce = 0; bounce < 6; bounce++) {
    let best = { t: Infinity, kind: null, obj: null };
    S.mirrors.forEach(m => {
      const h = M.scale(m.len / 2, u2(m.ang));
      const t = raySeg(pos, dir, M.sub(m.c, h), M.add(m.c, h));
      if (t != null && t < best.t) best = { t, kind: "mirror", obj: m };
    });
    if (W.shield && S.conv.C) {
      const h = M.scale(W.shield.len / 2, M.normalize(W.shield.dir));
      const t = raySeg(pos, dir, M.sub(W.shield.c, h), M.add(W.shield.c, h));
      if (t != null && t < best.t) best = { t, kind: "shield" };
    }
    for (const rc of (W.receivers || [])) {
      const t = rayCircle(pos, dir, rc.pos, rc.r);
      if (t != null && t < best.t) best = { t, kind: "receiver" };
    }
    if (S.station) {
      const t = rayCircle(pos, dir, S.station.pos, S.station.r);
      if (t != null && t < best.t) best = { t, kind: "receiver" };
    }
    for (const a of (W.asteroids || [])) {
      const t = rayCircle(pos, dir, a.pos, a.r);
      if (t != null && t < best.t) best = { t, kind: "rock" };
    }
    if (best.t === Infinity) { segs.push([pos, M.add(pos, M.scale(16, dir))]); break; }
    const end = M.add(pos, M.scale(best.t, dir));
    segs.push([pos, end]);
    if (best.kind === "mirror") {
      dir = M.normalize(M.matVec(M.reflectionMatrix(u2(best.obj.ang)), dir));
      pos = M.add(end, M.scale(0.01, dir));
    } else if (best.kind === "shield") {
      dir = M.normalize(M.matVec(S.conv.C, dir));
      pos = M.add(end, M.scale(0.01, dir));
    } else { if (best.kind === "receiver") powered = true; break; }
  }
  S.laserSegs = segs;
  if (powered && !S.powered) msg("⚡ Приёмник запитан!", true);
  S.powered = powered;
}

// ---------------- конвейер щита (финал) ----------------
const CHIP_MATS = () => {
  const e1 = M.normalize(S.W.shield.dir), e2 = [-e1[1], e1[0]];
  const E = M.matFromCols(e1, e2);
  return { ET: M.matT(E), TE: [[1, 0], [0, -1]], E };
};
function buildConveyorBar(box) {
  const wrap = document.createElement("div");
  wrap.className = "chips";
  wrap.innerHTML =
    `<div class="slot" data-i="0">шаг 1</div><span>→</span>` +
    `<div class="slot" data-i="1">шаг 2</div><span>→</span>` +
    `<div class="slot" data-i="2">шаг 3</div>`;
  const chips = [["ET", "Eᵀ · в мир щита"], ["TE", "TE · отразить"], ["E", "E · обратно"]];
  for (const [id, label] of chips) {
    const el = document.createElement("div");
    el.className = "chip"; el.textContent = label; el.dataset.id = id;
    el.onclick = () => {
      if (el.parentElement.classList.contains("slot")) {        // вернуть в лоток
        S.conv.slots[+el.parentElement.dataset.i] = null;
        el.parentElement.textContent = "шаг " + (+el.parentElement.dataset.i + 1);
        wrap.appendChild(el);
      } else {
        const i = S.conv.slots.indexOf(null);
        if (i < 0) return;
        S.conv.slots[i] = id;
        const slot = wrap.querySelector(`.slot[data-i="${i}"]`);
        slot.textContent = ""; slot.appendChild(el);
      }
      S.conv.C = null; S.powered = false;
    };
    wrap.appendChild(el);
  }
  const run = document.createElement("button");
  run.textContent = "⚡ Прошить щит";
  run.onclick = convRun;
  box.appendChild(wrap); box.appendChild(run);
}
function convRun() {
  if (S.conv.slots.includes(null)) { msg("Заполни все три слота программы!"); return; }
  const mats = CHIP_MATS();
  let C = [[1, 0], [0, 1]];
  for (const id of S.conv.slots) C = M.matMul(mats[id], C);   // слева направо
  S.conv.C = C; S.conv.ranOnce = true;
  const T = M.reflectionMatrix(S.W.shield.dir);
  const ok = [0, 1].every(i => [0, 1].every(j => Math.abs(C[i][j] - T[i][j]) < 1e-9));
  msg(ok ? "✅ Программа верна: Eᵀ перевёл, TE отразил, E вернул!"
         : "Щит прошит… но смотри, куда ушёл луч. Порядок блоков неверный.", ok);
}

// ============================================================
// ВВОД: прицеливание, зеркала, балка
// ============================================================
let drag = null;   // {kind:'aim'|'mirror'|'beam', i}
function evPos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * cv.width / r.width,
           y: (e.clientY - r.top) * cv.height / r.height };
}
function snap05(v) { return [Math.round(v[0] * 2) / 2, Math.round(v[1] * 2) / 2]; }

cv.addEventListener("pointerdown", e => {
  if (!S || S.complete) return;
  const p = evPos(e);
  // 1) ручки зеркал
  for (let i = 0; i < S.mirrors.length; i++) {
    const m = S.mirrors[i];
    const h = toScr(M.add(m.c, M.scale(m.len / 2 + 0.3, u2(m.ang))));
    if (Math.hypot(p.x - h.x, p.y - h.y) < 22) { drag = { kind: "mirror", i }; return; }
  }
  // 2) кончик балки
  if (S.beam) {
    const tip = toScr(M.add(S.W.beam.base, S.beam.v));
    if (Math.hypot(p.x - tip.x, p.y - tip.y) < 26) { drag = { kind: "beam" }; return; }
    drag = { kind: "beam" }; moveDrag(p); return;   // балку можно наводить откуда угодно
  }
  // 3) прицеливание тягой
  if (S.L.flight && !S.flying) { drag = { kind: "aim" }; moveDrag(p); }
});
cv.addEventListener("pointermove", e => { if (drag) { moveDrag(evPos(e)); e.preventDefault(); } });
window.addEventListener("pointerup", () => drag = null);

function moveDrag(p) {
  const w = fromScr(p.x, p.y);
  if (drag.kind === "mirror") {
    const m = S.mirrors[drag.i];
    m.ang = Math.atan2(w[1] - m.c[1], w[0] - m.c[0]);
  } else if (drag.kind === "beam") {
    const v = snap05(M.sub(w, S.W.beam.base));
    if (M.norm(v) > 0.2) S.beam.v = v;
  } else if (drag.kind === "aim") {
    const v = snap05(M.sub(w, chainTail()));
    S.plan.cur = M.norm(v) > 0.01 ? v : null;
  }
  updateBar();
}

window.addEventListener("keydown", e => {
  if (G.screen !== "game" || !S) return;
  if (e.key === "Enter" && S.L.flight) { launch(); e.preventDefault(); }
});

// ============================================================
// ОБНОВЛЕНИЕ И ПРОВЕРКА ЦЕЛЕЙ
// ============================================================
function update(dt) {
  S.t += dt;
  if (S.msgT > 0) S.msgT -= dt;
  stepBasisAnim(dt);
  stepFlight(dt);
  traceLaser();

  // мост-тень
  if (S.beam) {
    const d = M.dot(S.beam.v, S.W.rail.e);
    S.shadowOk = Math.abs(d - S.W.rail.need) <= 0.06;
    if (S.droneT != null) {
      S.droneT += (G.instant ? 10 : dt * 0.9);
      if (S.droneT >= 1) { S.droneT = null; S.droneDone = true; msg("📦 Дрон доставлен!", true); }
    }
  }

  // затухание следа
  for (const t of S.trail) t.a -= dt * 0.5;
  while (S.trail.length && S.trail[0].a <= 0) S.trail.shift();

  // цели
  let all = true;
  for (const o of S.L.objectives) {
    if (!S.objDone[o.id] && o.check(S)) S.objDone[o.id] = true;
    if (!S.objDone[o.id]) all = false;
  }
  if (all && S.L.objectives.length && !S.complete) {
    S.complete = true;
    setTimeout(() => G.mode === "endless" ? endlessNext() : ceremony(), G.instant ? 30 : 900);
  }

  // HUD топлива
  const hf = $("hud-fuel");
  if (S.W.fuel == null) hf.textContent = "⛽ ∞";
  else {
    hf.textContent = `⛽ ${f2(Math.max(0, S.W.fuel - S.fuelUsed))} / ${f2(S.W.fuel)}`;
    hf.className = (S.W.fuel - S.fuelUsed) < 1 ? "low" : "";
  }
}

// ============================================================
// ОТРИСОВКА
// ============================================================
function arrow(from, to, color, width, dash, alpha) {
  const a = toScr(from), b = toScr(to);
  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;
  ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = width;
  ctx.shadowColor = color; ctx.shadowBlur = 6;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 10;
  ctx.beginPath(); ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - L * Math.cos(ang - 0.45), b.y - L * Math.sin(ang - 0.45));
  ctx.lineTo(b.x - L * Math.cos(ang + 0.45), b.y - L * Math.sin(ang + 0.45));
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
function label(p, text, color, dx, dy) {
  const s = toScr(p);
  ctx.save(); ctx.font = "bold 14px system-ui"; ctx.fillStyle = color;
  ctx.shadowColor = "#000"; ctx.shadowBlur = 4;
  const w = ctx.measureText(text).width;
  ctx.fillText(text, Math.max(4, Math.min(cv.width - w - 4, s.x + (dx || 9))),
               Math.max(14, Math.min(cv.height - 6, s.y + (dy || -9))));
  ctx.restore();
}
function circle(p, r, fill, stroke, lw) {
  const s = toScr(p);
  ctx.save();
  ctx.beginPath(); ctx.arc(s.x, s.y, r * SC, 0, 7);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  const W = S.W;

  // звёзды (не искажаются - это далёкий фон)
  ctx.save();
  for (const st of S.stars) {
    ctx.globalAlpha = st.a; ctx.fillStyle = "#9fb0dd";
    ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 7); ctx.fill();
  }
  ctx.restore();

  // сетка (через матрицу базиса => кривой базис виден сразу)
  ctx.save(); ctx.strokeStyle = "#16224a"; ctx.lineWidth = 1;
  for (let x = -6; x <= 6; x++) {
    const a = toScr([x, -4]), b = toScr([x, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (let y = -4; y <= 4; y++) {
    const a = toScr([-6, y]), b = toScr([6, y]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();

  // силовое поле
  if (W.field) {
    const c1 = toScr([-6, W.field.y0]), c2 = toScr([6, W.field.y0]),
          c3 = toScr([6, W.field.y1]), c4 = toScr([-6, W.field.y1]);
    ctx.save();
    ctx.fillStyle = "#f59e0b18";
    ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y);
    ctx.lineTo(c3.x, c3.y); ctx.lineTo(c4.x, c4.y); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#f59e0b55"; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c4.x, c4.y); ctx.lineTo(c3.x, c3.y); ctx.stroke();
    ctx.restore();
    const my = (W.field.y0 + W.field.y1) / 2;
    for (let x = -5; x <= 5; x += 1.6)
      arrow([x, my], [x + 0.7, my], "#f59e0b", 2, null, 0.7);
    label([-5.6, my], "поле e = [1, 0]", "#f59e0b", 0, -14);
  }

  // рельса, разлом, мост, дрон
  if (W.rail) {
    const R = W.rail, e = R.e;
    const a = toScr(M.add(R.p0, M.scale(-2.2, e))), b = toScr(M.add(R.p0, M.scale(6.4, e)));
    ctx.save(); ctx.strokeStyle = "#334977"; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
    // разлом: участок, который должен накрыть мост
    const g1 = toScr(R.p0), g2 = toScr(M.add(R.p0, M.scale(R.need, e)));
    ctx.save(); ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 3; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.stroke(); ctx.restore();
    label(M.add(R.p0, M.scale(R.need / 2, e)), `разлом: ${R.need}`, "#ef4444", -20, 26);
    // мост = тень балки
    const d = M.dot(S.beam.v, e);
    if (d > 0.03) {
      const m2 = toScr(M.add(R.p0, M.scale(Math.min(d, 6.4), e)));
      ctx.save(); ctx.strokeStyle = S.shadowOk ? "#4ade80" : "#fbbf24";
      ctx.lineWidth = 9; ctx.lineCap = "round";
      ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(g1.x, g1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke(); ctx.restore();
      // "луч света" от балки к концу моста
      const tip = toScr(M.add(W.beam.base, S.beam.v));
      ctx.save(); ctx.strokeStyle = "#8fa1d0"; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(m2.x, m2.y); ctx.stroke(); ctx.restore();
    }
    // дрон
    if (S.droneT != null || S.droneDone) {
      const t = S.droneDone ? 1 : S.droneT;
      circle(M.add(R.p0, M.scale(t * R.need, e)), 0.16, "#fb923c", "#fed7aa", 2);
    } else {
      circle(M.add(R.p0, M.scale(-0.5, e)), 0.16, "#fb923c88", "#fb923c", 2);
    }
  }

  // балка-прожектор
  if (S.beam) {
    arrow(W.beam.base, M.add(W.beam.base, S.beam.v), "#38bdf8", 4.5);
    label(M.add(W.beam.base, S.beam.v), "балка v", "#38bdf8");
    const tip = toScr(M.add(W.beam.base, S.beam.v));
    ctx.save(); ctx.fillStyle = "#0d1430"; ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 8, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }

  // астероиды
  for (const a of (W.asteroids || [])) {
    circle(a.pos, a.r, "#2b3350", "#465379", 2.5);
    circle(M.add(a.pos, [a.r * 0.3, a.r * 0.25]), a.r * 0.22, "#222a44");
    circle(M.add(a.pos, [-a.r * 0.3, -a.r * 0.2]), a.r * 0.15, "#222a44");
  }

  // ядро сектора и его базис
  if (W.core) {
    const c = toScr(W.core.pos);
    ctx.save();
    ctx.strokeStyle = S.basisStep >= 3 ? "#4ade80" : "#e879f9";
    ctx.fillStyle = "#1a1030"; ctx.lineWidth = 2.5;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 3 * k + S.t * 0.25;
      const px = c.x + 24 * Math.cos(a), py = c.y + 24 * Math.sin(a);
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // оси базиса: рисуем МИРОВЫЕ [1,0] и [0,1] - трансформация покажет b1, b2
    const fixed = S.basisStep >= 3;
    arrow(W.core.pos, M.add(W.core.pos, [1, 0]), fixed ? "#4ade80" : "#e879f9", 4);
    arrow(W.core.pos, M.add(W.core.pos, [0, 1]), fixed ? "#4ade80" : "#f472b6", 4);
    label(M.add(W.core.pos, [1, 0]), fixed ? "e1" : "b1", fixed ? "#4ade80" : "#e879f9", 10, 16);
    label(M.add(W.core.pos, [0, 1]), fixed ? "e2" : "b2", fixed ? "#4ade80" : "#f472b6");
    if (!fixed && !nearCore())
      label(W.core.pos, "подлети к ядру", "#e879f9", -36, 42);
  }

  // зеркала
  for (const m of S.mirrors) {
    const h = M.scale(m.len / 2, u2(m.ang));
    const a = toScr(M.sub(m.c, h)), b = toScr(M.add(m.c, h));
    ctx.save();
    ctx.strokeStyle = "#7dd3fc"; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.shadowColor = "#7dd3fc"; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
    const knob = toScr(M.add(m.c, M.scale(m.len / 2 + 0.3, u2(m.ang))));
    ctx.save(); ctx.fillStyle = "#0d1430"; ctx.strokeStyle = "#7dd3fc"; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(knob.x, knob.y, 8, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }

  // щит финала
  if (W.shield) {
    const e1 = M.normalize(W.shield.dir);
    const h = M.scale(W.shield.len / 2, e1);
    const a = toScr(M.sub(W.shield.c, h)), b = toScr(M.add(W.shield.c, h));
    ctx.save();
    ctx.strokeStyle = S.conv.C ? "#a3e635" : "#5b6b9b"; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
    label(M.add(W.shield.c, M.scale(1.2, e1)), "щит", S.conv.C ? "#a3e635" : "#5b6b9b");
    if (S.station) {
      const pulse = 0.28 + 0.05 * Math.sin(S.t * 3);
      circle(S.station.pos, S.station.r + (S.powered ? pulse * 0.15 : 0), null,
             S.powered ? "#4ade80" : "#f472b6", 3);
      label(S.station.pos, "станция", S.powered ? "#4ade80" : "#f472b6", 12, 4);
    }
  }

  // лазер
  if (S.laserSegs.length) {
    ctx.save();
    ctx.strokeStyle = S.powered ? "#4ade80" : "#f87171";
    ctx.lineWidth = 3; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14;
    ctx.beginPath();
    for (const [p1, p2] of S.laserSegs) {
      const a = toScr(p1), b = toScr(p2);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke(); ctx.restore();
    circle(W.laser.pos, 0.14, "#f87171", "#fecaca", 2);
  }
  for (const rc of (W.receivers || []))
    circle(rc.pos, rc.r, S.powered ? "#14532d" : "#3b1c26", S.powered ? "#4ade80" : "#f472b6", 3);

  // док
  if (W.dock) {
    const locked = (W.dock.needPower && !S.powered) || (W.dock.needBasis && S.basisStep < 3);
    const col = S.docked ? "#4ade80" : (locked ? "#5b6b9b" : "#fbbf24");
    const pulse = 0.06 * Math.sin(S.t * 3);
    circle(W.dock.pos, W.dock.r + pulse, null, col, 3);
    circle(W.dock.pos, W.dock.r * 0.55, null, col, 2);
    let dl = "док";
    if (locked) dl = "док 🔒";
    else if (W.dock.arriveLen != null) dl = `док · импульс ${f2(W.dock.arriveLen)}`;
    label(M.add(W.dock.pos, [0, W.dock.r]), dl, col, -12, -10);
  }

  // след, план, корабль
  ctx.save();
  for (const t of S.trail) {
    const s = toScr(t.p);
    ctx.globalAlpha = t.a * 0.5; ctx.fillStyle = "#38bdf8";
    ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, 7); ctx.fill();
  }
  ctx.restore();

  if (S.L.flight) {
    let tail = S.ship.pos.slice();
    S.plan.legs.forEach((l, i) => {
      arrow(tail, M.add(tail, l), "#2f6fdb", 3.5, null, 0.85);
      tail = M.add(tail, l);
    });
    if (S.plan.cur) {
      arrow(tail, M.add(tail, S.plan.cur), "#38bdf8", 4.5);
      const tip = toScr(M.add(tail, S.plan.cur));
      ctx.save(); ctx.fillStyle = "#0d1430"; ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 7.5, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    // итоговая сумма пути
    if (S.plan.legs.length >= 1 && (S.plan.cur || S.plan.legs.length >= 2)) {
      let total = [0, 0];
      for (const l of S.plan.legs) total = M.add(total, l);
      if (S.plan.cur) total = M.add(total, S.plan.cur);
      arrow(S.ship.pos, M.add(S.ship.pos, total), "#8fa1d0", 2, [6, 6], 0.8);
      label(M.add(S.ship.pos, M.scale(0.55, total)),
            `итог = [${f2(total[0])}, ${f2(total[1])}]`, "#8fa1d0", 10, 20);
    }
  }

  // корабль
  {
    const s = toScr(S.ship.pos);
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(-S.ship.ang + Math.PI / 2);
    ctx.shadowColor = "#38bdf8"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#7dd3fc";
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(9, 10); ctx.lineTo(0, 5);
    ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill();
    if (S.flying) {
      ctx.fillStyle = "#fb923c";
      ctx.beginPath(); ctx.moveTo(-4, 10); ctx.lineTo(0, 17 + Math.random() * 5);
      ctx.lineTo(4, 10); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // цели (низ слева)
  ctx.save(); ctx.font = "14px system-ui";
  S.L.objectives.forEach((o, i) => {
    const done = !!S.objDone[o.id];
    ctx.fillStyle = done ? "#4ade80" : "#9fb0dd";
    ctx.fillText((done ? "✅ " : "◻ ") + o.text, 14, cv.height - 14 - (S.L.objectives.length - 1 - i) * 22);
  });
  if (G.mode === "endless") {
    ctx.fillStyle = "#fbbf24"; ctx.font = "bold 15px system-ui";
    ctx.fillText(`серия: ${G.streak}  ·  рекорд: ${save.endlessBest}`, 14, 24);
  }
  ctx.restore();

  // сообщение
  if (S.msg && S.msgT > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, S.msgT);
    ctx.font = "bold 16px system-ui";
    const w = ctx.measureText(S.msg.text).width;
    const x = (cv.width - w) / 2, y = cv.height - 64;
    ctx.fillStyle = "#0d1634ee";
    ctx.beginPath(); ctx.roundRect(x - 16, y - 24, w + 32, 36, 10); ctx.fill();
    ctx.strokeStyle = S.msg.good ? "#4ade80" : "#fbbf24"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = S.msg.good ? "#bbf7d0" : "#fde68a";
    ctx.fillText(S.msg.text, x, y);
    ctx.restore();
  }
}

// ============================================================
// ЦЕРЕМОНИЯ, ЗВЁЗДЫ, ЖУРНАЛ
// ============================================================
function ceremony() {
  const L = S.L;
  const star2 = L.world.par != null ? S.fuelUsed <= L.world.par + 1e-9 : S.hintsUsed === 0;
  const stars = { solve: true, eco: star2, q: false };
  $("cer-title").textContent = L.zone + " — пройден!";
  const lbl2 = L.world.par != null ? "топливо ≤ " + L.world.par : "без подсказок";
  const render = () => {
    $("cer-stars").innerHTML =
      (stars.solve ? "★" : "<span class='off'>★</span>") +
      (stars.eco ? "★" : "<span class='off'>★</span>") +
      (stars.q ? "★" : "<span class='off'>★</span>");
    $("cer-labels").textContent = "прошёл · " + lbl2 + " · понял смысл";
    const n = (stars.solve ? 1 : 0) + (stars.eco ? 1 : 0) + (stars.q ? 1 : 0);
    save.stars[G.level] = Math.max(save.stars[G.level] || 0, n);
    save.unlocked = Math.max(save.unlocked, G.level + 1);
    writeSave(); updateHudStars();
  };
  render();

  const jbox = $("cer-journal");
  if (L.journal && !save.journal.includes(G.level)) {
    save.journal.push(G.level); writeSave();
    jbox.style.display = "";
    jbox.innerHTML = `📓 <b>Новая запись в журнале:</b> ${L.journal.title}` +
      `<div class="frm">${L.journal.formula}</div>`;
  } else jbox.style.display = "none";

  const qbox = $("cer-question"); qbox.innerHTML = "";
  if (L.question) {
    const q = document.createElement("div"); q.className = "q";
    q.textContent = "⭐ Вопрос на третью звезду: " + L.question.q;
    qbox.appendChild(q);
    L.question.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.textContent = opt;
      b.onclick = () => {
        for (const bb of qbox.querySelectorAll("button")) bb.disabled = true;
        if (i === L.question.correct) { b.classList.add("right"); stars.q = true; }
        else {
          b.classList.add("wrong");
          qbox.querySelectorAll("button")[L.question.correct].classList.add("right");
        }
        render();
      };
      qbox.appendChild(b);
    });
  }
  $("cer-next").textContent = G.level + 1 < LEVELS.length ? "Дальше ▸" : "В меню";
  $("ceremony").classList.remove("hidden");
}

$("cer-next").addEventListener("click", () => {
  $("ceremony").classList.add("hidden");
  if (G.level + 1 < LEVELS.length) gotoLevel(G.level + 1);
  else { refreshMenu(); show("menu"); }
});

function showFinal() {
  const total = Object.values(save.stars).reduce((s, x) => s + x, 0);
  $("cer-title").textContent = "🌌 Координатное ядро восстановлено!";
  $("cer-stars").innerHTML = `<div style="font-size:20px">⭐ ${total} из ${(LEVELS.length - 1) * 3}</div>`;
  $("cer-labels").textContent = "";
  $("cer-journal").style.display = "";
  $("cer-journal").innerHTML =
    `ИРИС: «Ортонорма» снова летит ровно. Ты прошёл путь:<br><br>` +
    `<b>вектор → длина → сложение → нормализация → тень → разложение →<br>` +
    `отражение → композиция → Грам–Шмидт → смена базиса</b><br><br>` +
    `<div class="frm">T = E @ TE @ E.T</div><br>` +
    `ИРИС: ...стоп. Варп-двигатель стабилен только вдоль ОСОБЫХ направлений: ` +
    `они не поворачиваются, только растягиваются...<br>` +
    `<i>Продолжение: собственные векторы (урок 12 курса).</i><br><br>` +
    `🔓 Открыт «Бесконечный полёт» — жми в меню!`;
  $("cer-question").innerHTML = "";
  $("cer-next").textContent = "В меню";
  save.unlocked = Math.max(save.unlocked, LEVELS.length);
  writeSave();
  $("ceremony").classList.remove("hidden");
}

// ---------------- журнал и подсказки ----------------
function openJournal() {
  const list = $("jr-list"); list.innerHTML = "";
  const entries = save.journal.slice().sort((a, b) => a - b);
  if (!entries.length)
    list.innerHTML = `<div class="jr-empty">Пока пусто. Проходи сектора — формулы будут появляться здесь.</div>`;
  for (const li of entries) {
    const J = LEVELS[li] && LEVELS[li].journal;
    if (!J) continue;
    const div = document.createElement("div");
    div.className = "jr-entry";
    div.innerHTML = `<h3>${J.title}</h3><div class="words">${J.words}</div>` +
      `<div class="frm">${J.formula}</div><div class="code">${J.code}</div>`;
    list.appendChild(div);
  }
  $("journal").classList.remove("hidden");
}
$("jr-close").addEventListener("click", () => $("journal").classList.add("hidden"));
$("btn-journal").addEventListener("click", openJournal);
$("btn-journal-menu").addEventListener("click", openJournal);

$("btn-hint").addEventListener("click", () => {
  if (!S || !S.L.hints.length) return;
  if (S.hintLevel < S.L.hints.length) {
    S.hintsUsed++;
    $("hint-pop").textContent = "💡 " + S.L.hints[S.hintLevel];
    $("hint-pop").classList.remove("hidden");
    S.hintLevel++;
  }
});
$("hint-pop").addEventListener("click", () => $("hint-pop").classList.add("hidden"));

// ============================================================
// НАВИГАЦИЯ
// ============================================================
function gotoLevel(i) {
  G.level = i; G.mode = "campaign";
  const L = LEVELS[i];
  if (L.final) {
    newState({ ...L, world: { ship: [0, 0] }, objectives: [], tools: [], hints: [], intro: [] });
    show("game"); showFinal(); return;
  }
  newState(L);
  $("hud-zone").textContent = L.zone;
  $("hud-name").textContent = L.name;
  barSignature = ""; updateBar(); updateHudStars();
  $("hint-pop").classList.add("hidden");
  irisShow();
  show("game");
}

function updateHudStars() {
  const total = Object.values(save.stars).reduce((s, x) => s + x, 0);
  $("hud-stars").textContent = "★ " + total;
}

function buildLevelGrid() {
  const grid = $("level-grid"); grid.innerHTML = "";
  LEVELS.forEach((L, i) => {
    if (L.final) return;
    const locked = i > save.unlocked;
    const card = document.createElement("div");
    card.className = "lvl-card" + (locked ? " locked" : "");
    const st = save.stars[i] || 0;
    card.innerHTML = `<div class="deck">${L.zone}</div><b>${i + 1}. ${L.name}</b><br>` +
      `<span class="stars">${"★".repeat(st)}${"☆".repeat(3 - st)}</span>` + (locked ? " 🔒" : "");
    if (!locked) card.onclick = () => gotoLevel(i);
    grid.appendChild(card);
  });
}

function refreshMenu() {
  const done = save.unlocked >= LEVELS.length - 1;
  const be = $("btn-endless");
  be.disabled = !done;
  be.textContent = done ? `∞ Бесконечный полёт (рекорд: ${save.endlessBest})`
                        : "∞ Бесконечный полёт 🔒";
  $("btn-continue").textContent = save.unlocked === 0 ? "▶ Начать"
    : "▶ Продолжить (сектор " + (Math.min(save.unlocked, LEVELS.length - 2) + 1) + ")";
}

// ---------------- бесконечный полёт ----------------
function startEndless() {
  G.mode = "endless"; G.streak = 0;
  endlessLoad();
}
function endlessLoad() {
  const gen = ENDLESS_GEN[Math.floor(Math.random() * ENDLESS_GEN.length)];
  const L = gen();
  newState(L);
  $("hud-zone").textContent = L.zone;
  $("hud-name").textContent = L.name;
  barSignature = ""; updateBar();
  $("iris").classList.add("hidden");
  show("game");
}
function endlessNext() {
  G.streak++;
  save.endlessBest = Math.max(save.endlessBest, G.streak);
  writeSave();
  endlessLoad();
}
$("btn-endless").addEventListener("click", startEndless);

// ---------------- меню ----------------
$("btn-continue").addEventListener("click", () => gotoLevel(Math.min(save.unlocked, LEVELS.length - 1)));
$("btn-levels").addEventListener("click", () => { buildLevelGrid(); show("levels"); });
$("btn-back-menu").addEventListener("click", () => { refreshMenu(); show("menu"); });
$("btn-map").addEventListener("click", () => { buildLevelGrid(); show("levels"); });
$("btn-how").addEventListener("click", () => $("howto").classList.remove("hidden"));
$("how-close").addEventListener("click", () => $("howto").classList.add("hidden"));

// ---------------- главный цикл ----------------
let lastT = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (G.screen === "game" && S) { update(dt); draw(); }
  requestAnimationFrame(loop);
}
refreshMenu();
requestAnimationFrame(loop);

// отладочный доступ для автотестов
window.__game = {
  get S() { return S; }, G, save, LEVELS, M,
  gotoLevel, launch, resetShip, basisOp, convRun, startEndless,
  tools: TOOL_DEFS, update, ceremony,
  setCur(v) { S.plan.cur = v; updateBar(); },
  commit() { TOOL_DEFS.commit.fn(); },
  setMirror(i, ang) { S.mirrors[i].ang = ang; },
  setBeam(v) { S.beam.v = v; },
  convSet(slots) { S.conv.slots = slots.slice(); },
};
