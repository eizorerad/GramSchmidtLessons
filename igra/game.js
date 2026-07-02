// ============================================================
// ВЕКТОР: Ортонорма — игровой движок (прототип «Ступень A»)
// Чистый canvas + DOM, без внешних библиотек.
// Слои: комната (робот ходит) → головоломка (векторный стол)
// → церемония (звёзды, вопрос, журнал).
// ============================================================
"use strict";

// ---------------- сохранение ----------------
const SAVE_KEY = "vektor-ortonorma-v1";
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; }
  catch (e) { return {}; }
}
function writeSave() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
const save = Object.assign({ unlocked: 0, stars: {}, journal: [], endlessBest: 0 }, loadSave());

// ---------------- состояние ----------------
const G = {
  screen: "menu",        // menu | levels | game
  level: 0,
  mode: "campaign",      // campaign | endless
  endless: { streak: 0, task: null },
  hintsUsed: 0,
  dlgQueue: [], dlgIdx: 0,
  room: null,            // состояние комнаты
  PZ: null,              // состояние головоломки
  solvedThisLevel: false,
};

const $ = id => document.getElementById(id);

// ---------------- переключение экранов ----------------
function show(name) {
  ["menu", "levels", "game"].forEach(s => $("scr-" + s).classList.toggle("hidden", s !== name));
  G.screen = name;
}

// ============================================================
// КОМНАТА: палуба с роботом
// ============================================================
const TILE = 68, COLS = 13, ROWS = 8;
const roomCv = $("room"), rctx = roomCv.getContext("2d");
const CONSOLE_POS = { x: 6, y: 3 }, DOOR_POS = { x: 12, y: 4 }, START_POS = { x: 1, y: 4 };

function newRoom() {
  G.room = {
    bot: { x: START_POS.x, y: START_POS.y, px: START_POS.x, py: START_POS.y },
    path: [],                 // очередь клеток для клика-навигации
    doorOpen: false,
    consoleDone: false,
    t: 0,
  };
  G.solvedThisLevel = false;
  G.hintsUsed = 0;
}

function walkable(x, y) {
  if (y < 1 || y > ROWS - 2) return false;
  if (x < 1) return false;
  if (x > COLS - 2) return G.room.doorOpen && x === DOOR_POS.x && y === DOOR_POS.y;
  return true;
}

// поиск пути в ширину — для управления кликом
function bfsPath(from, to) {
  if (!walkable(to.x, to.y)) return [];
  const key = p => p.x + "," + p.y;
  const prev = { [key(from)]: null };
  const q = [from];
  while (q.length) {
    const c = q.shift();
    if (c.x === to.x && c.y === to.y) {
      const path = [];
      let k = c;
      while (k && !(k.x === from.x && k.y === from.y)) {
        path.unshift(k); k = prev[key(k)];
      }
      return path;
    }
    for (const d of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const n = { x: c.x + d[0], y: c.y + d[1] };
      if (walkable(n.x, n.y) && !(key(n) in prev)) { prev[key(n)] = c; q.push(n); }
    }
  }
  return [];
}

function tryStep(dx, dy) {
  if (G.PZ || !G.room || dialogActive()) return;
  const b = G.room.bot;
  if (Math.abs(b.px - b.x) > 0.15 || Math.abs(b.py - b.y) > 0.15) return; // ещё едет
  const nx = b.x + dx, ny = b.y + dy;
  if (walkable(nx, ny)) { b.x = nx; b.y = ny; G.room.path = []; onArrive(); }
}

function onArrive() {
  const b = G.room.bot;
  if (b.x === CONSOLE_POS.x && b.y === CONSOLE_POS.y && !G.solvedThisLevel) {
    setTimeout(() => { if (!G.PZ) openPuzzle(); }, 180);
  }
  if (b.x === DOOR_POS.x && b.y === DOOR_POS.y && G.room.doorOpen) {
    setTimeout(finishLevel, 220);
  }
}

// ---------- отрисовка комнаты ----------
function drawRoom() {
  const L = LEVELS[G.level];
  rctx.clearRect(0, 0, roomCv.width, roomCv.height);
  G.room.t += 0.016;

  // пол
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const wall = !((y >= 1 && y <= ROWS - 2) && x >= 1 && x <= COLS - 2);
      rctx.fillStyle = wall ? "#0a1128" : ((x + y) % 2 ? "#111c3f" : "#0f1938");
      rctx.fillRect(x * TILE, y * TILE, TILE - 1, TILE - 1);
    }

  // консоль
  const cp = CONSOLE_POS;
  rctx.fillStyle = G.solvedThisLevel ? "#14532d" : "#1e3a8a";
  rctx.fillRect(cp.x * TILE + 6, cp.y * TILE + 6, TILE - 13, TILE - 13);
  rctx.strokeStyle = G.solvedThisLevel ? "#4ade80" : "#60a5fa";
  rctx.lineWidth = 2.5;
  rctx.strokeRect(cp.x * TILE + 6, cp.y * TILE + 6, TILE - 13, TILE - 13);
  rctx.fillStyle = "#dbe4ff"; rctx.font = "22px system-ui"; rctx.textAlign = "center";
  rctx.fillText(G.solvedThisLevel ? "✓" : "▲", cp.x * TILE + TILE / 2, cp.y * TILE + TILE / 2 + 8);

  // дверь
  const dp = DOOR_POS, glow = G.room.doorOpen ? (0.6 + 0.4 * Math.sin(G.room.t * 4)) : 0.15;
  rctx.fillStyle = G.room.doorOpen ? `rgba(74,222,128,${glow * 0.5})` : "#1a2244";
  rctx.fillRect(dp.x * TILE + 2, dp.y * TILE - TILE * 0.5, TILE - 4, TILE * 2);
  rctx.strokeStyle = G.room.doorOpen ? "#4ade80" : "#35509f";
  rctx.strokeRect(dp.x * TILE + 2, dp.y * TILE - TILE * 0.5, TILE - 4, TILE * 2);
  rctx.fillStyle = G.room.doorOpen ? "#bbf7d0" : "#7f92c8"; rctx.font = "13px system-ui";
  rctx.fillText(G.room.doorOpen ? "ОТКРЫТО" : "ЗАПЕРТО", dp.x * TILE + TILE / 2, dp.y * TILE - TILE * 0.5 - 8);

  // плавное движение робота к цели / по пути
  const b = G.room.bot, sp = 0.14;
  if (Math.abs(b.px - b.x) < 0.01 && Math.abs(b.py - b.y) < 0.01 && G.room.path.length) {
    const n = G.room.path.shift();
    b.x = n.x; b.y = n.y;
    if (!G.room.path.length) onArrive();
    else if (n.x === CONSOLE_POS.x && n.y === CONSOLE_POS.y) { G.room.path = []; onArrive(); }
  }
  b.px += (b.x - b.px) * sp * 2.2;
  b.py += (b.y - b.py) * sp * 2.2;

  // робот
  const rx = b.px * TILE + TILE / 2, ry = b.py * TILE + TILE / 2;
  rctx.save();
  rctx.strokeStyle = "#38bdf8"; rctx.lineWidth = 3;             // антенна
  rctx.beginPath(); rctx.moveTo(rx, ry - 20); rctx.lineTo(rx, ry - 30); rctx.stroke();
  rctx.fillStyle = "#38bdf8";
  rctx.beginPath(); rctx.arc(rx, ry - 32, 3.4, 0, 7); rctx.fill();
  const grd = rctx.createLinearGradient(rx, ry - 22, rx, ry + 22); // корпус
  grd.addColorStop(0, "#3a4a80"); grd.addColorStop(1, "#222f5c");
  rctx.fillStyle = grd; rctx.strokeStyle = "#4a5c9b"; rctx.lineWidth = 2;
  roundRect(rctx, rx - 20, ry - 20, 40, 40, 13); rctx.fill(); rctx.stroke();
  rctx.fillStyle = "#7dd3fc";                                    // глаз
  rctx.beginPath(); rctx.arc(rx, ry - 3, 8, 0, 7); rctx.fill();
  rctx.fillStyle = "#0b1020";
  rctx.beginPath(); rctx.arc(rx + 2, ry - 4, 3.4, 0, 7); rctx.fill();
  rctx.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// управление комнатой
window.addEventListener("keydown", e => {
  if (G.screen !== "game") return;
  if (dialogActive()) {
    if (e.key === " " || e.key === "Enter") { advanceDialog(); e.preventDefault(); }
    return;
  }
  if (G.PZ) return;
  const map = { ArrowUp: [0,-1], ArrowDown: [0,1], ArrowLeft: [-1,0], ArrowRight: [1,0],
                w: [0,-1], s: [0,1], a: [-1,0], d: [1,0],
                ц: [0,-1], ы: [0,1], ф: [-1,0], в: [1,0] };
  const d = map[e.key];
  if (d) { tryStep(d[0], d[1]); e.preventDefault(); }
});
roomCv.addEventListener("pointerdown", e => {
  if (dialogActive()) { advanceDialog(); return; }
  if (G.PZ) return;
  const r = roomCv.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) * roomCv.width / r.width / TILE);
  const y = Math.floor((e.clientY - r.top) * roomCv.height / r.height / TILE);
  G.room.path = bfsPath({ x: G.room.bot.x, y: G.room.bot.y }, { x, y });
});

// ---------------- диалоги ИРИС ----------------
function startDialog(lines) {
  if (!lines || !lines.length) { $("dialogue").classList.add("hidden"); return; }
  G.dlgQueue = lines; G.dlgIdx = 0;
  $("dialogue").classList.remove("hidden");
  $("dlg-text").textContent = lines[0];
}
function dialogActive() { return !$("dialogue").classList.contains("hidden"); }
function advanceDialog() {
  G.dlgIdx++;
  if (G.dlgIdx >= G.dlgQueue.length) $("dialogue").classList.add("hidden");
  else $("dlg-text").textContent = G.dlgQueue[G.dlgIdx];
}
$("dialogue").addEventListener("click", advanceDialog);

// ============================================================
// ГОЛОВОЛОМКА: векторный стол
// ============================================================
const pzCv = $("pz-canvas"), pctx = pzCv.getContext("2d");
const PS = 44;                                  // пикселей на единицу
const PCX = pzCv.width / 2, PCY = pzCv.height / 2;
const toScr = p => ({ x: PCX + p[0] * PS, y: PCY - p[1] * PS });
const toWorld = (x, y) => [(x - PCX) / PS, (PCY - y) / PS];

function openPuzzle(customCfg) {
  const L = LEVELS[G.level];
  const cfg = customCfg || L.puzzle;
  if (cfg.type === "final") { showFinal(); return; }

  G.PZ = {
    cfg, type: cfg.type,
    v: (cfg.vectors || []).map(s => s.start.slice()),
    locked: [],                    // оси, принятые гироскопом
    dissolved: [],                 // индексы растворившихся векторов
    selected: cfg.type === "gyro" ? null
             : (cfg.vectors || []).findIndex(s => s.draggable),
    solved: false,
    conveyor: cfg.type === "conveyor" ? { slots: [null, null, null], ran: null } : null,
    codeOrder: cfg.type === "code" ? cfg.lines.map((_, i) => i) : null,
    cellPicked: null,
    msg: "",
    hintLevel: 0,
  };
  $("pz-title").textContent = (G.mode === "endless" ? "∞ " : "") +
    (customCfg ? "Бесконечная лаборатория" : LEVELS[G.level].name);
  $("pz-goal").textContent = cfg.goalText || cfg.text || "";
  $("pz-hint-text").innerHTML = "";
  $("pz-msg").textContent = "";
  $("pz-hint").style.display = (G.mode === "endless") ? "none" : "";
  buildPuzzleButtons();
  $("puzzle").classList.remove("hidden");
  drawPuzzle(); updatePuzzleInfo();
}

function closePuzzle() { $("puzzle").classList.add("hidden"); G.PZ = null; }
$("pz-close").addEventListener("click", () => {
  if (G.mode === "endless") { endEndless(); return; }
  closePuzzle();
});

// ---------- кнопки операций ----------
function buildPuzzleButtons() {
  const box = $("pz-buttons"); box.innerHTML = "";
  const PZ = G.PZ, cfg = PZ.cfg;

  if (PZ.type === "drag" && cfg.buttons) {
    for (const b of cfg.buttons) {
      const el = document.createElement("button");
      el.textContent = b.label;
      el.onclick = () => applyOp(b.id, PZ.selected);
      box.appendChild(el);
    }
  }

  if (PZ.type === "gyro") {
    const mk = (label, fn, id) => {
      const el = document.createElement("button");
      el.textContent = label; el.onclick = fn; el.dataset.op = id;
      box.appendChild(el); return el;
    };
    mk("⚙ Нормализовать (v / |v|)", () => applyOp("normalize", PZ.selected), "normalize");
    mk("✂ Вычесть тень на e1", () => applyOp("subaxis0", PZ.selected), "subaxis0");
    mk("✂ Вычесть тень на e2", () => applyOp("subaxis1", PZ.selected), "subaxis1");
    refreshGyroButtons();
  }

  if (PZ.type === "conveyor") buildConveyorUI(box);
  if (PZ.type === "code") buildCodeUI(box);
}

function refreshGyroButtons() {
  const PZ = G.PZ;
  for (const el of $("pz-buttons").querySelectorAll("button")) {
    if (el.dataset.op === "subaxis0") el.disabled = PZ.locked.length < 1;
    if (el.dataset.op === "subaxis1") el.disabled = PZ.locked.length < 2;
    if (el.dataset.op === "normalize") el.disabled = false;
  }
}

// применить операцию к вектору с индексом i
function applyOp(op, i) {
  const PZ = G.PZ;
  if (PZ.solved) return;
  if (i == null || i < 0) { setMsg("Сначала выбери вектор щелчком по стрелке."); return; }
  if (PZ.dissolved.includes(i) || isLockedIdx(i)) return;

  if (op === "normalize") {
    if (M.norm(PZ.v[i]) < 1e-9) { setMsg("Нулевую стрелку нельзя нормализовать!"); return; }
    PZ.v[i] = M.normalize(PZ.v[i]);
    setMsg("Разделили на длину: теперь длина 1.");
  }
  if (op === "subshadow") {
    PZ.v[i] = M.subtractShadow(PZ.v[i], PZ.cfg.rail);
    if (M.norm(PZ.v[i]) < 1e-9) {
      setMsg("Стрелка растворилась — она лежала прямо на рельсе! Возвращаю исходную.");
      PZ.v[i] = PZ.cfg.vectors[i].start.slice();
    } else setMsg("Тень вычтена: осталась часть, перпендикулярная рельсе.");
  }
  if (op === "subaxis0" || op === "subaxis1") {
    const ax = PZ.locked[op === "subaxis0" ? 0 : 1];
    if (!ax) return;
    PZ.v[i] = M.subtractShadow(PZ.v[i], ax.v);
    if (M.norm(PZ.v[i]) < 1e-9) {
      dissolve(i);
    } else setMsg("Тень на " + ax.name + " вычтена.");
  }

  if (PZ.type === "gyro") tryLockAxis(i);
  afterChange();
}

function isLockedIdx(i) { return G.PZ.locked.some(a => a.src === i); }

function dissolve(i) {
  const PZ = G.PZ;
  PZ.dissolved.push(i);
  PZ.v[i] = [0, 0];
  setMsg("💨 " + PZ.cfg.vectors[i].label +
    " растворился! Он не нёс нового направления — его можно собрать из уже готовых осей.");
}

// гироскоп сам забирает единичный вектор, перпендикулярный готовым осям
function tryLockAxis(i) {
  const PZ = G.PZ, v = PZ.v[i];
  if (!M.близко(M.norm(v), 1, 0.01)) return;
  for (const a of PZ.locked) {
    const d = M.dot(v, a.v);
    if (Math.abs(d) > 0.01) {
      setMsg("Гироскоп отверг вектор: он не перпендикулярен " + a.name +
        " (скалярное произведение = " + d.toFixed(2) + ", а нужно 0). Вычти тень!");
      return;
    }
  }
  const name = "e" + (PZ.locked.length + 1);
  PZ.locked.push({ v: v.slice(), name, src: i });
  setMsg("🔒 Гироскоп принял ось " + name + " = [" +
    v.map(x => x.toFixed(2)).join(", ") + "]", true);
  refreshGyroButtons();
}

function setMsg(text, good) {
  $("pz-msg").textContent = text;
  $("pz-msg").className = "msg" + (good ? " good" : "");
}

// после каждого изменения: перерисовать, обновить числа, проверить решение
function afterChange() {
  drawPuzzle(); updatePuzzleInfo();
  const PZ = G.PZ;
  if (PZ.solved) return;
  if (checkPuzzle()) {
    PZ.solved = true;
    setMsg("✅ Решено!", true);
    setTimeout(onPuzzleSolved, 650);
  }
}

function checkPuzzle() {
  const PZ = G.PZ, cfg = PZ.cfg;
  if (PZ.type === "drag") return !!cfg.check(PZ);
  if (PZ.type === "gyro") {
    const okAxes = PZ.locked.length >= cfg.slots;
    if (cfg.expectDissolve) return okAxes && PZ.dissolved.length >= 1;
    return okAxes;
  }
  if (PZ.type === "cell")
    return PZ.cellPicked && M.близкиВекторы(PZ.cellPicked, cfg.target);
  if (PZ.type === "conveyor")
    return PZ.conveyor.ran === "ok";
  if (PZ.type === "code")
    return PZ.codeRan === true;
  return false;
}

function onPuzzleSolved() {
  if (G.mode === "endless") { endlessNext(); return; }
  closePuzzle();
  G.solvedThisLevel = true;
  G.room.doorOpen = true;
  startDialog(["ИРИС: Есть! Система палубы в норме. Дверь открыта — идём дальше!"]);
}

// ---------- живые числа ----------
function updatePuzzleInfo() {
  const PZ = G.PZ, cfg = PZ.cfg;
  let html = "";
  if (cfg.info) html = cfg.info(PZ);
  else if (PZ.type === "gyro") {
    html = PZ.cfg.vectors.map((s, i) => {
      if (PZ.dissolved.includes(i)) return `${s.label}: <b>растворился</b>`;
      const v = PZ.v[i], lockedAs = PZ.locked.find(a => a.src === i);
      let row = `${s.label} = <b>[${f2(v[0])}, ${f2(v[1])}]</b> · длина ${f2(M.norm(v))}`;
      if (lockedAs) row += ` 🔒 принят как <b>${lockedAs.name}</b>`;
      else if (PZ.selected === i) row += " ← выбран";
      return row;
    }).join("<br>");
    html += `<br>Осей в гироскопе: <b>${PZ.locked.length} / ${cfg.slots}</b>`;
  }
  else if (PZ.type === "cell")
    html = `Маяк: <b>[${cfg.point[0]}, ${cfg.point[1]}]</b><br>Щёлкни клетку с отражением.`;
  else if (PZ.type === "conveyor")
    html = `Точка r = <b>[${f2(cfg.point[0])}, ${f2(cfg.point[1])}]</b><br>` +
           `Блоки: <b>Eᵀ</b> — в координаты зеркала, <b>TE</b> — отразить, <b>E</b> — обратно.`;
  else if (PZ.type === "code")
    html = "Стрелками ↑/↓ меняй порядок строк, потом запускай.";
  $("pz-info").innerHTML = html;
}

// ---------- отрисовка головоломки ----------
function parrow(from, to, color, width, dash, alpha) {
  const a = toScr(from), b = toScr(to);
  pctx.save();
  pctx.globalAlpha = alpha == null ? 1 : alpha;
  pctx.strokeStyle = pctx.fillStyle = color; pctx.lineWidth = width;
  if (dash) pctx.setLineDash(dash);
  pctx.beginPath(); pctx.moveTo(a.x, a.y); pctx.lineTo(b.x, b.y); pctx.stroke();
  pctx.setLineDash([]);
  const ang = Math.atan2(b.y - a.y, b.x - a.x), Lh = 10;
  pctx.beginPath(); pctx.moveTo(b.x, b.y);
  pctx.lineTo(b.x - Lh * Math.cos(ang - 0.45), b.y - Lh * Math.sin(ang - 0.45));
  pctx.lineTo(b.x - Lh * Math.cos(ang + 0.45), b.y - Lh * Math.sin(ang + 0.45));
  pctx.closePath(); pctx.fill();
  pctx.restore();
}
function plabel(p, text, color, dx, dy) {
  const s = toScr(p);
  pctx.save(); pctx.font = "bold 14px system-ui"; pctx.fillStyle = color;
  const w = pctx.measureText(text).width;
  pctx.fillText(text, Math.max(4, Math.min(pzCv.width - w - 4, s.x + (dx || 8))),
                Math.max(14, Math.min(pzCv.height - 5, s.y + (dy || -8))));
  pctx.restore();
}
function pgrid() {
  pctx.save();
  pctx.strokeStyle = "#182448"; pctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    pctx.beginPath(); pctx.moveTo(PCX + i * PS, 0); pctx.lineTo(PCX + i * PS, pzCv.height); pctx.stroke();
    pctx.beginPath(); pctx.moveTo(0, PCY - i * PS); pctx.lineTo(pzCv.width, PCY - i * PS); pctx.stroke();
  }
  pctx.strokeStyle = "#2c3d74";
  pctx.beginPath(); pctx.moveTo(0, PCY); pctx.lineTo(pzCv.width, PCY); pctx.stroke();
  pctx.beginPath(); pctx.moveTo(PCX, 0); pctx.lineTo(PCX, pzCv.height); pctx.stroke();
  pctx.restore();
}

function drawPuzzle() {
  const PZ = G.PZ; if (!PZ) return;
  const cfg = PZ.cfg;
  pctx.clearRect(0, 0, pzCv.width, pzCv.height);
  pgrid();

  // рельса и тень
  if (cfg.rail) {
    const e = cfg.rail;
    const a = toScr([-e[0] * 6.5, -e[1] * 6.5]), b = toScr([e[0] * 6.5, e[1] * 6.5]);
    pctx.save(); pctx.strokeStyle = "#10b98133"; pctx.lineWidth = 18; pctx.lineCap = "round";
    pctx.beginPath(); pctx.moveTo(a.x, a.y); pctx.lineTo(b.x, b.y); pctx.stroke(); pctx.restore();
    parrow([0, 0], e, "#10b981", 3.5);
    plabel(e, "e", "#10b981", 8, 18);
    const ten = M.project(PZ.v[0], e);
    if (M.norm(ten) > 0.02 && !PZ.dissolved.includes(0)) {
      parrow([0, 0], ten, "#ef4444", 5);
      plabel(M.scale(0.5, ten), "тень", "#ef4444", 6, 22);
      const s1 = toScr(PZ.v[0]), s2 = toScr(ten);
      pctx.save(); pctx.strokeStyle = "#5b6b9b"; pctx.setLineDash([4, 4]); pctx.lineWidth = 1.4;
      pctx.beginPath(); pctx.moveTo(s1.x, s1.y); pctx.lineTo(s2.x, s2.y); pctx.stroke(); pctx.restore();
    }
  }

  // маяк (уровень нормализации)
  if (cfg.beacon) {
    const bcn = cfg.beacon;
    const b = toScr([bcn[0] * 6.5, bcn[1] * 6.5]);
    pctx.save(); pctx.strokeStyle = "#10b981"; pctx.setLineDash([6, 6]); pctx.lineWidth = 2;
    pctx.beginPath(); pctx.moveTo(PCX, PCY); pctx.lineTo(b.x, b.y); pctx.stroke(); pctx.restore();
    plabel([bcn[0] * 4.6, bcn[1] * 4.6], "маяк", "#10b981");
    // единичная окружность как ориентир
    pctx.save(); pctx.strokeStyle = "#2c3d74"; pctx.setLineDash([3, 5]);
    pctx.beginPath(); pctx.arc(PCX, PCY, PS, 0, 7); pctx.stroke(); pctx.restore();
  }

  // прибор скалярного произведения
  if (cfg.meter && PZ.v.length >= 2) {
    const d = M.dot(PZ.v[0], PZ.v[1]);
    const w = 180, x0 = pzCv.width - w - 18, y0 = 18;
    pctx.save();
    pctx.fillStyle = "#101a3a"; pctx.strokeStyle = "#2c3d74";
    roundRect(pctx, x0, y0, w, 46, 9); pctx.fill(); pctx.stroke();
    pctx.fillStyle = Math.abs(d) < 1e-9 ? "#4ade80" : (d > 0 ? "#fbbf24" : "#f87171");
    pctx.font = "bold 19px ui-monospace, monospace"; pctx.textAlign = "center";
    pctx.fillText("a · b = " + f2(d), x0 + w / 2, y0 + 24);
    pctx.font = "11px system-ui"; pctx.fillStyle = "#8fa1d0";
    pctx.fillText(Math.abs(d) < 1e-9 ? "⊥ ПЕРПЕНДИКУЛЯРНО!" : "нужен ноль", x0 + w / 2, y0 + 39);
    pctx.restore();
  }

  // тип cell: зеркало вдоль X, маяк, кликнутая клетка
  if (PZ.type === "cell") {
    pctx.save(); pctx.strokeStyle = "#a3e63544"; pctx.lineWidth = 16; pctx.lineCap = "round";
    pctx.beginPath(); pctx.moveTo(10, PCY); pctx.lineTo(pzCv.width - 10, PCY); pctx.stroke();
    pctx.restore();
    plabel([4.3, 0], "зеркало", "#a3e635", 0, -12);
    const p = toScr(cfg.point);
    pctx.fillStyle = "#38bdf8";
    pctx.beginPath(); pctx.arc(p.x, p.y, 8, 0, 7); pctx.fill();
    plabel(cfg.point, "маяк [" + cfg.point + "]", "#38bdf8");
    if (PZ.cellPicked) {
      const c = toScr(PZ.cellPicked);
      const ok = M.близкиВекторы(PZ.cellPicked, cfg.target);
      pctx.strokeStyle = ok ? "#4ade80" : "#f87171"; pctx.lineWidth = 3;
      pctx.strokeRect(c.x - PS / 2, c.y - PS / 2, PS, PS);
      if (ok) {
        pctx.fillStyle = "#ec4899";
        pctx.beginPath(); pctx.arc(c.x, c.y, 8, 0, 7); pctx.fill();
        const s1 = toScr(cfg.point);
        pctx.save(); pctx.strokeStyle = "#5b6b9b"; pctx.setLineDash([5, 5]);
        pctx.beginPath(); pctx.moveTo(s1.x, s1.y); pctx.lineTo(c.x, c.y); pctx.stroke(); pctx.restore();
      }
    }
  }

  // тип conveyor: зеркало, точка и этапы прогона
  if (PZ.type === "conveyor") drawConveyorScene();

  // сами векторы
  if (cfg.vectors) {
    cfg.vectors.forEach((spec, i) => {
      if (PZ.dissolved.includes(i)) return;
      const v = PZ.v[i];
      const isSel = PZ.selected === i && (PZ.type === "gyro" || cfg.vectors.filter(s => s.draggable).length > 1);
      const lockedAs = PZ.locked.find(a => a.src === i);
      parrow([0, 0], v, lockedAs ? "#4ade80" : spec.color, isSel ? 5.5 : 4);
      plabel(v, lockedAs ? lockedAs.name : spec.label, lockedAs ? "#4ade80" : spec.color);
      // ручка
      const s = toScr(v);
      pctx.save();
      pctx.fillStyle = "#0d1430"; pctx.strokeStyle = lockedAs ? "#4ade80" : spec.color;
      pctx.lineWidth = isSel ? 3.5 : 2.5;
      pctx.beginPath(); pctx.arc(s.x, s.y, 7.5, 0, 7); pctx.fill(); pctx.stroke();
      pctx.restore();
    });
  }
}

// ---------- перетаскивание в головоломке ----------
let pzDrag = null;
function pzPos(e) {
  const r = pzCv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * pzCv.width / r.width,
           y: (e.clientY - r.top) * pzCv.height / r.height };
}
pzCv.addEventListener("pointerdown", e => {
  const PZ = G.PZ; if (!PZ) return;
  const p = pzPos(e);

  if (PZ.type === "cell") {
    const w = toWorld(p.x, p.y);
    PZ.cellPicked = [Math.round(w[0]), Math.round(w[1])];
    if (!checkPuzzle()) setMsg("Не здесь. Помни: расстояние до зеркала сохраняется!");
    afterChange();
    return;
  }

  if (!PZ.cfg.vectors) return;
  // ищем ближайшую ручку
  let best = -1, bestD = 24;
  PZ.cfg.vectors.forEach((spec, i) => {
    if (PZ.dissolved.includes(i)) return;
    const s = toScr(PZ.v[i]);
    const d = Math.hypot(p.x - s.x, p.y - s.y);
    if (d < bestD) { best = i; bestD = d; }
  });
  if (best >= 0) {
    PZ.selected = best;
    const spec = PZ.cfg.vectors[best];
    if (spec.draggable !== false && PZ.type !== "gyro" && !isLockedIdx(best)) pzDrag = best;
    if (PZ.type === "gyro" && !isLockedIdx(best)) {
      pzDrag = null;                       // в гироскопе векторы не таскают
      setMsg("Выбран " + spec.label + ". Применяй операции кнопками.");
    }
    afterChange();
    e.preventDefault();
  }
});
pzCv.addEventListener("pointermove", e => {
  const PZ = G.PZ;
  if (!PZ || pzDrag == null || PZ.solved) return;
  const p = pzPos(e), w = toWorld(p.x, p.y);
  const snap = PZ.cfg.vectors[pzDrag].snap;
  let v = w;
  if (snap) v = [Math.round(w[0] / snap) * snap, Math.round(w[1] / snap) * snap];
  if (Math.abs(v[0]) < 1e-9 && Math.abs(v[1]) < 1e-9) return;
  PZ.v[pzDrag] = v;
  afterChange();
  e.preventDefault();
});
window.addEventListener("pointerup", () => pzDrag = null);

// ---------- конвейер (уровень 9) ----------
function buildConveyorUI(box) {
  const PZ = G.PZ;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="slotrow" id="cv-slots">
      <div class="slot" data-i="0">шаг 1</div><span>→</span>
      <div class="slot" data-i="1">шаг 2</div><span>→</span>
      <div class="slot" data-i="2">шаг 3</div>
    </div>
    <div class="chips" id="cv-tray"></div>`;
  box.appendChild(wrap);
  const run = document.createElement("button");
  run.textContent = "▶ Запустить точку через конвейер";
  run.onclick = runConveyor;
  box.appendChild(run);

  const CHIPS = [
    { id: "ET", label: "Eᵀ (в мир зеркала)" },
    { id: "TE", label: "TE (отразить)" },
    { id: "E",  label: "E (обратно)" },
  ];
  const tray = wrap.querySelector("#cv-tray");
  for (const c of CHIPS) {
    const el = document.createElement("div");
    el.className = "chip"; el.textContent = c.label; el.dataset.id = c.id;
    el.onclick = () => {                      // чип → первый пустой слот
      const slotI = PZ.conveyor.slots.indexOf(null);
      if (slotI < 0 || el.parentElement.classList.contains("slot")) return;
      PZ.conveyor.slots[slotI] = c.id;
      wrap.querySelector(`.slot[data-i="${slotI}"]`).replaceChildren(el);
      PZ.conveyor.ran = null; drawPuzzle();
    };
    tray.appendChild(el);
  }
  for (const slot of wrap.querySelectorAll(".slot")) {
    slot.onclick = e => {                     // клик по занятому слоту → чип назад
      const chip = slot.querySelector(".chip");
      if (!chip || e.target === chip) {}      // клики по чипу в слоте тоже возвращают
      if (!chip) return;
      PZ.conveyor.slots[+slot.dataset.i] = null;
      slot.textContent = "шаг " + (+slot.dataset.i + 1);
      tray.appendChild(chip);
      PZ.conveyor.ran = null; drawPuzzle();
    };
  }
}

function conveyorMatrices() {
  const cfg = G.PZ.cfg;
  const e1 = M.normalize(cfg.mirrorDir), e2 = [-e1[1], e1[0]];
  const E = M.matFromCols(e1, e2);
  return { E, ET: M.matT(E), TE: [[1, 0], [0, -1]], e1 };
}

function runConveyor() {
  const PZ = G.PZ, cfg = PZ.cfg;
  if (PZ.conveyor.slots.includes(null)) { setMsg("Заполни все три слота!"); return; }
  const mats = conveyorMatrices();
  let p = cfg.point.slice();
  const stages = [p.slice()];
  for (const id of PZ.conveyor.slots) { p = M.matVec(mats[id], p); stages.push(p.slice()); }
  PZ.conveyor.stages = stages;

  const правильное = M.matVec(M.reflectionMatrix(cfg.mirrorDir), cfg.point);
  if (M.близкиВекторы(p, правильное, 1e-6)) {
    PZ.conveyor.ran = "ok";
    setMsg("✅ Точка отразилась правильно: Eᵀ перевёл, TE отразил, E вернул!", true);
  } else {
    PZ.conveyor.ran = "bad";
    setMsg("Точка улетела не туда (должна быть зеркально по другую сторону). Поменяй порядок блоков.");
  }
  afterChange();
}

function drawConveyorScene() {
  const PZ = G.PZ, cfg = PZ.cfg;
  const e1 = M.normalize(cfg.mirrorDir);
  // зеркало
  const a = toScr(M.scale(-6.5, e1)), b = toScr(M.scale(6.5, e1));
  pctx.save(); pctx.strokeStyle = "#a3e63544"; pctx.lineWidth = 15; pctx.lineCap = "round";
  pctx.beginPath(); pctx.moveTo(a.x, a.y); pctx.lineTo(b.x, b.y); pctx.stroke(); pctx.restore();
  plabel(M.scale(4.4, e1), "зеркало", "#a3e635");
  // исходная точка
  const p0 = toScr(cfg.point);
  pctx.fillStyle = "#38bdf8"; pctx.beginPath(); pctx.arc(p0.x, p0.y, 8, 0, 7); pctx.fill();
  plabel(cfg.point, "r", "#38bdf8");
  // правильный ответ - едва заметная цель
  const target = M.matVec(M.reflectionMatrix(cfg.mirrorDir), cfg.point);
  const pt = toScr(target);
  pctx.save(); pctx.strokeStyle = "#ec489966"; pctx.setLineDash([4, 4]); pctx.lineWidth = 2;
  pctx.beginPath(); pctx.arc(pt.x, pt.y, 11, 0, 7); pctx.stroke(); pctx.restore();
  plabel(target, "цель", "#ec4899", 12, 4);
  // этапы прогона
  if (PZ.conveyor && PZ.conveyor.stages) {
    const cols = ["#38bdf8", "#fbbf24", "#f472b6", "#4ade80"];
    PZ.conveyor.stages.forEach((s, i) => {
      const q = toScr(s);
      pctx.fillStyle = cols[i];
      pctx.beginPath(); pctx.arc(q.x, q.y, 6, 0, 7); pctx.fill();
      if (i > 0) {
        const prev = toScr(PZ.conveyor.stages[i - 1]);
        pctx.save(); pctx.strokeStyle = cols[i] + "88"; pctx.lineWidth = 1.6;
        pctx.beginPath(); pctx.moveTo(prev.x, prev.y); pctx.lineTo(q.x, q.y); pctx.stroke();
        pctx.restore();
        plabel(s, "шаг " + i, cols[i], 9, 4);
      }
    });
  }
}

// ---------- кодовая комната (уровень 10) ----------
function buildCodeUI(box) {
  const PZ = G.PZ;
  const list = document.createElement("div"); list.id = "code-list";
  box.appendChild(list);
  const run = document.createElement("button");
  run.textContent = "▶ Запустить код";
  run.onclick = runCode;
  box.appendChild(run);
  renderCodeLines();
}
function renderCodeLines() {
  const PZ = G.PZ, list = $("code-list");
  list.innerHTML = "";
  PZ.codeOrder.forEach((lineIdx, pos) => {
    const row = document.createElement("div"); row.className = "codeline";
    const up = document.createElement("button"); up.textContent = "↑";
    const dn = document.createElement("button"); dn.textContent = "↓";
    up.disabled = pos === 0; dn.disabled = pos === PZ.codeOrder.length - 1;
    up.onclick = () => { swap(pos, pos - 1); };
    dn.onclick = () => { swap(pos, pos + 1); };
    const txt = document.createElement("div"); txt.className = "txt";
    txt.textContent = PZ.cfg.lines[lineIdx].text;
    row.append(up, dn, txt); list.appendChild(row);
  });
  function swap(a, b) {
    const o = PZ.codeOrder;
    [o[a], o[b]] = [o[b], o[a]];
    PZ.codeRan = false;
    renderCodeLines();
  }
}
function runCode() {
  const PZ = G.PZ, lines = PZ.cfg.lines;
  const done = new Set();
  for (const idx of PZ.codeOrder) {
    const line = lines[idx];
    for (const need of line.needs) {
      if (!done.has(need)) {
        const needText = lines.find(l => l.id === need).text.split("=")[0].trim();
        setMsg(`⛔ Ошибка: строка «${line.text}» использует «${needText}», ` +
               `но он ещё не создан. Переставь строки!`);
        return;
      }
    }
    done.add(line.id);
  }
  PZ.codeRan = true;
  setMsg("✅ Код выполнен! Ядро принимает матрицу T = E·TE·Eᵀ...", true);
  afterChange();
}

// ---------- подсказки ----------
$("pz-hint").addEventListener("click", () => {
  if (G.mode === "endless") return;
  const PZ = G.PZ, hints = LEVELS[G.level].hints;
  if (!hints.length) return;
  if (PZ.hintLevel < hints.length) {
    G.hintsUsed++;
    const div = document.createElement("div");
    div.className = "h";
    div.textContent = "💡 " + hints[PZ.hintLevel];
    $("pz-hint-text").appendChild(div);
    PZ.hintLevel++;
  }
  if (PZ.hintLevel >= hints.length) $("pz-hint").style.display = "none";
});

// ============================================================
// ЦЕРЕМОНИЯ: звёзды + вопрос + журнал
// ============================================================
function finishLevel() {
  if ($("ceremony").classList.contains("hidden") === false) return;
  const L = LEVELS[G.level];
  const stars = { solve: true, nohint: G.hintsUsed === 0, question: false };

  $("cer-title").textContent = L.deck + " починена!";
  renderStars(stars);

  // журнал
  const jbox = $("cer-journal");
  if (L.journal && !save.journal.includes(G.level)) {
    save.journal.push(G.level);
    jbox.innerHTML = `📓 <b>Новая запись в журнале:</b> ${L.journal.title}` +
      `<div class="frm">${L.journal.formula}</div>`;
    jbox.style.display = "";
  } else jbox.style.display = "none";

  // вопрос на третью звезду
  const qbox = $("cer-question");
  qbox.innerHTML = "";
  if (L.question) {
    const q = document.createElement("div"); q.className = "q";
    q.textContent = "⭐ Вопрос на третью звезду: " + L.question.q;
    qbox.appendChild(q);
    L.question.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.textContent = opt;
      b.onclick = () => {
        for (const bb of qbox.querySelectorAll("button")) bb.disabled = true;
        if (i === L.question.correct) {
          b.classList.add("right");
          stars.question = true;
        } else {
          b.classList.add("wrong");
          qbox.querySelectorAll("button")[L.question.correct].classList.add("right");
        }
        renderStars(stars);
        commitStars(stars);
      };
      qbox.appendChild(b);
    });
  }
  commitStars(stars);
  $("ceremony").classList.remove("hidden");
}

function renderStars(stars) {
  const n = (stars.solve ? 1 : 0) + (stars.nohint ? 1 : 0) + (stars.question ? 1 : 0);
  $("cer-stars").innerHTML =
    `<span>${stars.solve ? "★" : "<span class='off'>★</span>"}</span>` +
    `<span>${stars.nohint ? "★" : "<span class='off'>★</span>"}</span>` +
    `<span>${stars.question ? "★" : "<span class='off'>★</span>"}</span>` +
    `<div class="star-label">решил · без подсказок · понял смысл</div>`;
}

function commitStars(stars) {
  const n = (stars.solve ? 1 : 0) + (stars.nohint ? 1 : 0) + (stars.question ? 1 : 0);
  save.stars[G.level] = Math.max(save.stars[G.level] || 0, n);
  save.unlocked = Math.max(save.unlocked, G.level + 1);
  writeSave();
  updateHud();
}

$("cer-next").addEventListener("click", () => {
  $("ceremony").classList.add("hidden");
  if (G.level + 1 < LEVELS.length) gotoLevel(G.level + 1);
  else { refreshMenu(); show("menu"); }
});

// ============================================================
// ФИНАЛЬНЫЙ ЭКРАН (уровень 11)
// ============================================================
function showFinal() {
  const total = Object.values(save.stars).reduce((s, x) => s + x, 0);
  $("cer-title").textContent = "🌌 Координатное ядро восстановлено!";
  $("cer-stars").innerHTML = `<div style="font-size:20px">Собрано звёзд: ⭐ ${total} из ${(LEVELS.length - 1) * 3}</div>`;
  $("cer-journal").style.display = "";
  $("cer-journal").innerHTML =
    `ИРИС: «Ортонорма» снова летит ровно. Ты прошёл весь путь:<br><br>` +
    `<b>вектор → длина → нормализация → скалярное произведение → тень →<br>` +
    `вычитание тени → Грам–Шмидт → зеркало → смена базиса → код</b><br><br>` +
    `<div class="frm">T = E @ TE @ E.T</div><br>` +
    `ИРИС: ...стоп. Сканирую варп-двигатель. Странно: он стабилен только вдоль ` +
    `ОСОБЫХ направлений — они не поворачиваются, только растягиваются...<br>` +
    `<i>Продолжение следует: собственные векторы (урок 12 курса).</i><br><br>` +
    `🔓 Открыт режим «Бесконечная лаборатория» — тренируйся в меню!`;
  $("cer-question").innerHTML = "";
  save.unlocked = Math.max(save.unlocked, LEVELS.length);
  writeSave();
  $("ceremony").classList.remove("hidden");
  $("cer-next").textContent = "В меню";
}

// ============================================================
// БЕСКОНЕЧНАЯ ЛАБОРАТОРИЯ
// ============================================================
function startEndless() {
  G.mode = "endless";
  G.endless.streak = 0;
  endlessNext();
}
function endlessNext() {
  closePuzzle();
  if (G.endless.task) {
    G.endless.streak++;
    save.endlessBest = Math.max(save.endlessBest, G.endless.streak);
    writeSave();
  }
  const gen = ENDLESS_TASKS[Math.floor(Math.random() * ENDLESS_TASKS.length)];
  const t = gen.make();
  G.endless.task = t;
  openPuzzle({
    type: "drag",
    goalText: `Серия: ${G.endless.streak} (рекорд ${save.endlessBest}) — ${t.text}`,
    vectors: t.vectors,
    rail: t.rail || null,
    meter: t.meter || false,
    info(PZ) {
      const v = PZ.v[PZ.v.length - 1];
      let s = `v = <b>[${f2(v[0])}, ${f2(v[1])}]</b> · длина = <b>${f2(M.norm(v))}</b>`;
      if (t.rail) s += `<br>тень: v · e = <b>${f2(M.dot(v, t.rail))}</b>`;
      if (t.meter) s += `<br>a · b = <b>${f2(M.dot(PZ.v[0], PZ.v[1]))}</b>`;
      return s;
    },
    check(PZ) { return t.check.call(t, PZ); },
  });
}
function endEndless() {
  G.mode = "campaign";
  G.endless.task = null;
  closePuzzle();
  show("menu");
  refreshMenu();
}

// ============================================================
// ЖУРНАЛ
// ============================================================
function openJournal() {
  const list = $("jr-list");
  list.innerHTML = "";
  const entries = save.journal.slice().sort((a, b) => a - b);
  if (!entries.length) {
    list.innerHTML = `<div class="jr-empty">Пока пусто. Чини палубы — формулы будут появляться здесь.</div>`;
  }
  for (const li of entries) {
    const J = LEVELS[li].journal;
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

// ============================================================
// НАВИГАЦИЯ ПО УРОВНЯМ
// ============================================================
function gotoLevel(i) {
  G.level = i;
  G.mode = "campaign";
  newRoom();
  const L = LEVELS[i];
  $("hud-deck").textContent = L.deck;
  $("hud-name").textContent = L.name;
  updateHud();
  show("game");
  $("cer-next").textContent = "Дальше ▸";
  if (L.puzzle.type === "final") { showFinal(); return; }
  startDialog(L.intro);
}
function updateHud() {
  const total = Object.values(save.stars).reduce((s, x) => s + x, 0);
  $("hud-stars").textContent = "★ " + total;
}

function buildLevelGrid() {
  const grid = $("level-grid");
  grid.innerHTML = "";
  LEVELS.forEach((L, i) => {
    if (L.puzzle.type === "final") return;
    const locked = i > save.unlocked;
    const card = document.createElement("div");
    card.className = "lvl-card" + (locked ? " locked" : "");
    const st = save.stars[i] || 0;
    card.innerHTML = `<div class="deck">${L.deck}</div><b>${i + 1}. ${L.name}</b><br>` +
      `<span class="stars">${"★".repeat(st)}${"☆".repeat(3 - st)}</span>` +
      (locked ? " 🔒" : "");
    if (!locked) card.onclick = () => gotoLevel(i);
    grid.appendChild(card);
  });
}

function refreshMenu() {
  const done = save.unlocked >= LEVELS.length - 1;
  const be = $("btn-endless");
  be.disabled = !done;
  be.textContent = done
    ? `∞ Бесконечная лаборатория (рекорд: ${save.endlessBest})`
    : "∞ Бесконечная лаборатория 🔒";
  $("btn-continue").textContent =
    save.unlocked === 0 ? "▶ Начать" : "▶ Продолжить (уровень " + (Math.min(save.unlocked, LEVELS.length - 2) + 1) + ")";
}

// ---------------- кнопки меню ----------------
$("btn-continue").addEventListener("click", () => gotoLevel(Math.min(save.unlocked, LEVELS.length - 1)));
$("btn-levels").addEventListener("click", () => { buildLevelGrid(); show("levels"); });
$("btn-back-menu").addEventListener("click", () => { refreshMenu(); show("menu"); });
$("btn-journal-menu").addEventListener("click", openJournal);
$("btn-journal").addEventListener("click", openJournal);
$("btn-map").addEventListener("click", () => { buildLevelGrid(); show("levels"); });
$("btn-how").addEventListener("click", () => $("howto").classList.remove("hidden"));
$("how-close").addEventListener("click", () => $("howto").classList.add("hidden"));
$("btn-endless").addEventListener("click", startEndless);

// ---------------- главный цикл ----------------
function loop() {
  if (G.screen === "game" && G.room) drawRoom();
  requestAnimationFrame(loop);
}
refreshMenu();
loop();

// отладочный доступ для автотестов (не влияет на игру)
window.__game = { G, save, gotoLevel, openPuzzle, closePuzzle, applyOp, checkPuzzle,
                  afterChange, finishLevel, runConveyor, runCode, startEndless, LEVELS, M };
