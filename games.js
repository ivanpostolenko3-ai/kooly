"use strict";

/* =========================================================
   Mängud — онлайн-игры с учениками своей школы.
   Соединение: WebSocket к облачному посреднику (worker/games.js, лобби на школу).
   Правила — games-rules.js; ход соперника принимается, только если он разрешён правилами.
   state.games = { nick, school, pid, avatar? } — pid: случайный id устройства (чтобы вернуться в игру после обрыва),
   avatar: фото профиля, уменьшенное до 96×96 JPEG (data:-ссылка, несколько КБ). Его видит только соперник в партии.
   ========================================================= */

const GAME_SCHOOLS = [{ id: "narvaeesti", name: "Narva Eesti Gümnaasium" }];

const GAME_LIST = [
  { id: "chess", name: "Male", icon: '<img class="gi" src="pieces/wN.svg" alt="" />', hint: "Klassikaline male" },
  { id: "checkers", name: "Kabe", icon: '<span class="gi disc w"></span>', hint: "Vene kabe, löömine on kohustuslik" },
  { id: "tictactoe", name: "Trips-traps-trull", icon: "✕", hint: "Kolm ühes reas" },
  { id: "battleship", name: "Laevade pommitamine", icon: "⚓", hint: "Leia ja uputa vastase laevad" },
];

const EMOTES = ["👍", "😄", "😮", "😅", "Hea mäng!", "Edu!"];

// Те же правила ника, что на сервере (worker/games.js).
const NICK_BAD = /(хуй|хуе|хуё|пизд|бля|еба|ёба|ебл|сука|залуп|мудак|пидор|пидар|гандон|fuck|shit|bitch|cunt|nigg|fag|dick|pussy|türa|tura|munn|perse|vitt|lits|pede|hoor)/i;

function cleanNick(raw) {
  const nick = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (nick.length < 3) return { error: "Vähemalt 3 märki" };
  if (!/^[\p{L}\p{N} _.-]+$/u.test(nick)) return { error: "Ainult tähed, numbrid, tühik, _ . -" };
  if (NICK_BAD.test(nick.replace(/[\s_.-]/g, ""))) return { error: "Vali viisakam hüüdnimi" };
  return { nick };
}

const gameInfo = (id) => GAME_LIST.find((g) => g.id === id);
const schoolName = (id) => GAME_SCHOOLS.find((s) => s.id === id)?.name || id;

let gWs = null;
let gConnected = false;
let gStats = null; // { online, games: { chess: { waiting, playing } } }
let gWaiting = null; // id игры, для которой ищем соперника
let gMatch = null; // текущая партия
let gEditProfile = false;
let gNickError = "";
let gRetry = 0;
let gRetryTimer = null;
let gIdleTimer = null;
let gEmoteTimer = null;
let gPhotoDraft; // фото в форме профиля до «Salvesta»: undefined — не меняли, null — убрали, строка — новое
let gNickDraft = null; // введённый ник не теряется, пока выбираем фото

/* ---------- Соединение ---------- */

function gamesNeedConnection() {
  return Boolean(state.games?.nick) && (currentTab === "games" || gWaiting || (gMatch && !gMatch.over));
}

function gamesConnect() {
  if (!gamesNeedConnection() || (gWs && gWs.readyState <= 1)) return;
  clearTimeout(gRetryTimer);
  const url = `${proxyUrl().replace(/^http/, "ws")}/games/ws?school=${encodeURIComponent(state.games.school)}`;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    return gamesRetry();
  }
  gWs = ws;
  ws.onopen = () => gSend({ t: "hello", pid: state.games.pid, nick: state.games.nick, avatar: state.games.avatar || null });
  ws.onmessage = (e) => {
    try {
      gamesMessage(JSON.parse(e.data));
    } catch {
      // битое сообщение
    }
  };
  ws.onclose = () => {
    if (gWs !== ws) return;
    gWs = null;
    gConnected = false;
    gamesRerender();
    gamesRetry();
  };
}

function gamesRetry() {
  if (!gamesNeedConnection() || document.hidden) return;
  clearTimeout(gRetryTimer);
  gRetryTimer = setTimeout(gamesConnect, Math.min(10000, 1000 * 2 ** gRetry++));
}

function gamesDisconnect() {
  clearTimeout(gRetryTimer);
  if (gWs) {
    const ws = gWs;
    gWs = null;
    gConnected = false;
    ws.close();
  }
}

function gSend(msg) {
  if (gWs?.readyState === 1) {
    gWs.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

// Вызывается при каждой отрисовке: подключиться на вкладке «Mängud», отключиться через полминуты после ухода.
function gamesOnRender() {
  clearTimeout(gIdleTimer);
  if (gamesNeedConnection()) gamesConnect();
  else if (gWs) gIdleTimer = setTimeout(() => !gamesNeedConnection() && gamesDisconnect(), 30000);
}

// Ушёл из приложения во время партии — сервер даёт 15 секунд вернуться, потом засчитывает поражение.
document.addEventListener("visibilitychange", () => {
  const playing = gMatch && !gMatch.over;
  if (document.hidden) {
    if (playing) gSend({ t: "away" });
    return;
  }
  if (playing) gSend({ t: "back" });
  if (gamesNeedConnection()) {
    gRetry = 0;
    gamesConnect();
  }
  if (playing) tickClock();
});

function gamesRerender() {
  if (currentTab === "games") renderGames();
}

/* ---------- Сообщения сервера ---------- */

function gamesMessage(m) {
  switch (m.t) {
    case "hi":
      gConnected = true;
      gRetry = 0;
      // Партия закончилась, пока нас не было (вышло время, ушли из приложения, соперник сдался).
      if (m.last && gMatch && !gMatch.over && gMatch.room === m.last.room) finishMatch(m.last.win ? { win: true, text: winText(m.last.reason) } : { win: false, text: loseText(m.last.reason) });
      if (gWaiting) gSend({ t: "find", game: gWaiting }); // связь оборвалась во время поиска — ищем снова
      gamesRerender();
      break;
    case "stats":
      gStats = m;
      updateGameStats();
      break;
    case "waiting":
      gWaiting = m.game;
      gamesRerender();
      break;
    case "matched":
    case "resume":
      startMatch(m);
      break;
    case "move":
      if (gMatch && !gMatch.over) {
        gMatch.moves.push({ s: m.s, m: m.m });
        afterMove();
      }
      break;
    case "opp-away":
      if (gMatch) gMatch.oppAway = true;
      gamesRerender();
      break;
    case "opp-back":
      if (gMatch) gMatch.oppAway = false;
      gamesRerender();
      break;
    case "opp-left":
      if (gMatch && !gMatch.over) finishMatch({ win: true, text: winText(m.reason) });
      break;
    case "lost":
      if (gMatch && !gMatch.over) finishMatch({ win: false, text: loseText(m.reason) });
      break;
    case "draw":
      if (gMatch && !gMatch.over) finishMatch({ draw: true, text: m.reason === "timeout" ? "Laevu ei paigutatud 3 minutiga" : "Mõlemad lahkusid" });
      break;
    case "clock":
      setClock(m);
      break;
    case "rematch-ask": // соперник хочет реванш
      if (gMatch?.over && gMatch.room === m.room && gMatch.rematch !== "declined-by-me") {
        gMatch.rematch = gMatch.rematch === "asked" ? "asked" : "offered";
        if (navigator.vibrate) navigator.vibrate(80);
        gamesRerender();
      }
      break;
    case "rematch-no":
    case "rematch-gone":
      if (gMatch?.over && (!m.room || gMatch.room === m.room)) {
        gMatch.rematch = "gone";
        gamesRerender();
      }
      break;
    case "emote":
      showEmote(m.e);
      break;
    case "error":
      if (m.code === "nick") {
        gNickError = "Server ei lubanud seda hüüdnime — vali teine";
        gEditProfile = true;
        gamesDisconnect();
        gamesRerender();
      }
      break;
  }
}

const winText = (reason) => ({ resign: "Vastane andis alla", timeout: "Vastase aeg sai otsa", disconnect: "Vastane lahkus mängust" })[reason] || "Võit";
const loseText = (reason) => ({ resign: "Andsid alla", timeout: "Sinu aeg sai otsa (3 min)", disconnect: "Lahkusid mängust" })[reason] || "Kaotus";

/* ---------- Время на ход (3 минуты, считает сервер) ---------- */

let gClockTimer = null;

function setClock(c) {
  if (!gMatch || !c) return;
  gMatch.clock = { turn: c.turn, deadline: Date.now() + c.left };
  tickClock();
}

function clockText() {
  const c = gMatch?.clock;
  if (!c || c.turn === null || gMatch.over) return "";
  const left = Math.max(0, Math.ceil((c.deadline - Date.now()) / 1000));
  const mine = c.turn === gMatch.seat || c.turn === -1;
  return `${mine ? "Sinu aeg" : "Vastase aeg"} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

// Раз в секунду обновляем только цифры (без перерисовки доски).
function tickClock() {
  clearInterval(gClockTimer);
  const update = () => {
    const el = document.querySelector("[data-gclock]");
    if (!gMatch || gMatch.over) return clearInterval(gClockTimer);
    if (!el) return;
    const c = gMatch.clock;
    const left = c ? (c.deadline - Date.now()) / 1000 : 999;
    el.textContent = clockText();
    el.classList.toggle("warn", left <= 30 && (c.turn === gMatch.seat || c.turn === -1));
    el.hidden = !el.textContent;
  };
  update();
  gClockTimer = setInterval(update, 1000);
}

/* ---------- Партия ---------- */

function startMatch(m) {
  const resumed = m.t === "resume";
  gWaiting = null;
  gMatch = { room: m.room, game: m.game, seat: m.seat, opp: m.opp, oppAvatar: m.oppAvatar || null, moves: m.moves || [], over: null, oppAway: false, sel: null, promo: null, sentEnd: false };
  if (m.game === "battleship") {
    const key = `kooly-bs-${m.room}`;
    let fleet = null;
    try {
      fleet = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      // нет
    }
    gMatch.fleet = fleet || RULES.randomFleet();
    saveFleet();
  }
  if (!resumed) {
    toast(`Vastane leitud: ${m.opp}`);
    if (navigator.vibrate) navigator.vibrate(150);
  }
  if (currentTab !== "games") switchTab("games");
  afterMove();
  setClock(m.clock);
}

function saveFleet() {
  try {
    localStorage.setItem(`kooly-bs-${gMatch.room}`, JSON.stringify(gMatch.fleet));
  } catch {
    // память недоступна — флот живёт до перезагрузки
  }
}

function sendMove(m) {
  if (!gMatch || gMatch.over) return;
  gMatch.moves.push({ s: gMatch.seat, m });
  const turn = matchView(gMatch).nextSeat; // сервер запускает 3 минуты тому, чей теперь ход
  if (!gSend({ t: "move", m, turn: turn ?? undefined })) {
    gMatch.moves.pop();
    return toast("Ühendus katkes — ootan…");
  }
  gMatch.sel = null;
  gMatch.promo = null;
  afterMove();
}

// После каждого хода: пересчитать позицию, ответить на выстрел (морской бой), проверить конец партии.
function afterMove() {
  const g = gMatch;
  const pos = matchView(g);
  g.view = pos;
  if (g.game === "battleship" && pos.answer !== null && !g.over) {
    const shots = new Set([...pos.oppShots.keys(), pos.answer]);
    return sendMove({ res: RULES.answerShot(g.fleet, shots, pos.answer) });
  }
  if (pos.result && !g.over) {
    finishMatch(pos.result);
    if (!g.sentEnd) {
      g.sentEnd = true;
      gSend({ t: "end" });
    }
    return;
  }
  gamesRerender();
}

function finishMatch(result) {
  gMatch.over = result;
  gMatch.sel = null;
  try {
    localStorage.removeItem(`kooly-bs-${gMatch.room}`);
  } catch {
    // нет
  }
  if (navigator.vibrate) navigator.vibrate(result.win ? [80, 60, 80] : 200);
  gamesRerender();
}

// Позиция и всё, что нужно для экрана, из списка ходов.
function matchView(g) {
  const mine = (s) => s === g.seat;
  if (g.game === "chess" || g.game === "checkers") {
    const chess = g.game === "chess";
    let st = chess ? RULES.chessInit() : RULES.checkersInit();
    for (const { m } of g.moves) {
      const legal = chess ? RULES.chessLegal(st) : RULES.checkersLegal(st);
      const mv = legal.find((x) => (chess ? RULES.chessSame(x, m) : RULES.checkersSame(x, m)));
      if (mv) st = chess ? RULES.chessApply(st, mv) : RULES.checkersApply(st, mv);
    }
    const myColor = g.seat === 0 ? "w" : "b";
    const res = chess ? RULES.chessResult(st) : RULES.checkersResult(st);
    let result = null;
    if (res) {
      const reasons = { mate: "Matt", stalemate: "Patt — viik", material: "Viik — matiks pole jõudu", fifty: "Viik (50 käigu reegel)", nomoves: "Käike pole" };
      result = res.winner === null ? { draw: true, text: reasons[res.reason] } : { win: res.winner === myColor, text: reasons[res.reason] };
    }
    return { st, myTurn: st.turn === myColor, legal: chess ? RULES.chessLegal(st) : RULES.checkersLegal(st), result, check: chess && RULES.chessInCheck(st), nextSeat: result ? null : st.turn === "w" ? 0 : 1 };
  }
  if (g.game === "tictactoe") {
    const cells = Array(9).fill(null);
    for (const { s, m } of g.moves) if (Number.isInteger(m.i) && !cells[m.i]) cells[m.i] = s === 0 ? "X" : "O";
    const res = RULES.tttResult(cells);
    const mark = g.seat === 0 ? "X" : "O";
    const result = res ? (res.winner ? { win: res.winner === mark, text: "Kolm ühes reas" } : { draw: true, text: "Viik" }) : null;
    return { cells, line: res?.line || null, myTurn: !res && g.moves.length % 2 === g.seat, result, mark, nextSeat: res ? null : g.moves.length % 2 };
  }
  // Морской бой
  const ready = [false, false];
  const myShots = new Map(), oppShots = new Map();
  let turn = 0, pending = null, result = null;
  const mark = (board, res) => {
    board.set(res.i, res.hit ? "hit" : "miss");
    if (res.sunk) {
      for (const x of res.sunk) board.set(x, "sunk");
      for (const x of RULES.around(res.sunk)) if (!board.has(x)) board.set(x, "near");
    }
  };
  for (const { s, m } of g.moves) {
    if (m.ready) ready[s] = true;
    else if (Number.isInteger(m.shot)) pending = { s, i: m.shot };
    else if (m.res && pending && pending.s !== s) {
      const shooter = pending.s;
      mark(mine(shooter) ? myShots : oppShots, m.res);
      if (!m.res.hit) turn = 1 - shooter;
      if (m.res.lose) result = { win: mine(shooter), text: mine(shooter) ? "Kõik vastase laevad on põhjas" : "Sinu laevad on põhjas" };
      pending = null;
    }
  }
  const started = ready[0] && ready[1];
  return {
    ready, started, myShots, oppShots, result,
    answer: pending && !mine(pending.s) ? pending.i : null,
    waitingAnswer: Boolean(pending && mine(pending.s)),
    myTurn: started && !pending && !result && turn === g.seat,
    // Чей ход для таймера: при расстановке — кто ещё не готов (-1 — оба), при выстреле — стреляющий.
    nextSeat: result ? null : !started ? (ready[0] || ready[1] ? (ready[0] ? 1 : 0) : -1) : pending ? pending.s : turn,
  };
}

/* ---------- Действия ---------- */

function handleGamesAction(action, btn) {
  const g = gMatch;
  switch (action) {
    case "g-save-profile": {
      const input = document.getElementById("g-nick");
      const r = cleanNick(input?.value);
      if (r.error) {
        gNickError = r.error;
        return renderGames();
      }
      const school = document.getElementById("g-school")?.value || GAME_SCHOOLS[0].id;
      const changed = state.games?.nick !== r.nick || state.games?.school !== school;
      const avatar = gPhotoDraft !== undefined ? gPhotoDraft : state.games?.avatar || null;
      const avatarChanged = avatar !== (state.games?.avatar || null);
      state.games = { pid: state.games?.pid || newId() + newId() + Math.random().toString(36).slice(2, 8), nick: r.nick, school, avatar };
      gNickError = "";
      gEditProfile = false;
      gPhotoDraft = undefined;
      gNickDraft = null;
      save();
      if (changed) gamesDisconnect(); // переподключиться с новым ником / в новую школу (фото уйдёт в hello)
      else if (avatarChanged) gSend({ t: "avatar", a: avatar });
      return render();
    }
    case "g-edit-profile":
      gEditProfile = true;
      return renderGames();
    case "g-cancel-profile":
      gEditProfile = false;
      gNickError = "";
      gPhotoDraft = undefined;
      gNickDraft = null;
      return renderGames();
    case "g-photo-remove":
      gNickDraft = document.getElementById("g-nick")?.value ?? gNickDraft;
      gPhotoDraft = null;
      return renderGames();
    case "g-find":
      gWaiting = btn.dataset.game;
      gSend({ t: "find", game: gWaiting });
      return renderGames();
    case "g-cancel":
      gSend({ t: "cancel" });
      gWaiting = null;
      return renderGames();
    case "g-resign":
      if (!g || g.over) return;
      return askConfirm("Kas annad alla? Vastane võidab.", "Anna alla").then((ok) => {
        if (!ok || gMatch !== g || g.over) return; // пока думали, партия могла закончиться
        gSend({ t: "resign" });
        finishMatch({ win: false, text: "Andsid alla" });
      });
    case "g-rematch":
      if (!g?.over) return;
      g.rematch = "asked";
      gSend({ t: "rematch", room: g.room });
      return renderGames();
    case "g-rematch-no":
      if (g?.over) {
        gSend({ t: "rematch-no", room: g.room });
        g.rematch = "declined-by-me";
      }
      return renderGames();
    case "g-again": {
      const game = g?.game;
      if (g?.over && g.rematch !== "gone") gSend({ t: "rematch-no", room: g.room }); // ушли искать другого — реванша не будет
      gMatch = null;
      gWaiting = game;
      gSend({ t: "find", game });
      return renderGames();
    }
    case "g-lobby":
      if (g?.over && g.rematch !== "gone") gSend({ t: "rematch-no", room: g.room });
      gMatch = null;
      return renderGames();
    case "g-emote":
      if (!g || g.over) return;
      gSend({ t: "emote", e: Number(btn.dataset.e) });
      return showEmote(Number(btn.dataset.e), true);
    case "g-sq":
      return g?.game === "chess" ? chessTap(Number(btn.dataset.sq)) : checkersTap(Number(btn.dataset.sq));
    case "g-promo":
      if (g?.promo) sendMove({ f: g.promo.f, t: g.promo.t, p: btn.dataset.p });
      return;
    case "g-ttt":
      if (g?.view.myTurn && !g.view.cells[Number(btn.dataset.i)]) sendMove({ i: Number(btn.dataset.i) });
      return;
    case "g-bs-shuffle":
      if (g && !g.view.ready[g.seat]) {
        g.fleet = RULES.randomFleet();
        saveFleet();
        renderGames();
      }
      return;
    case "g-bs-ready":
      if (g && !g.view.ready[g.seat]) sendMove({ ready: 1 });
      return;
    case "g-shot": {
      const i = Number(btn.dataset.i);
      if (g?.view.myTurn && !g.view.myShots.has(i)) sendMove({ shot: i });
      return;
    }
  }
}

function chessTap(sq) {
  const g = gMatch, v = g.view;
  if (!v.myTurn || g.over) return;
  const myColor = g.seat === 0 ? "w" : "b";
  if (g.sel !== null) {
    const moves = v.legal.filter((m) => m.f === g.sel && m.t === sq);
    if (moves.length > 1) {
      g.promo = { f: g.sel, t: sq }; // превращение пешки — выбрать фигуру
      return renderGames();
    }
    if (moves.length === 1) return sendMove({ f: moves[0].f, t: moves[0].t });
  }
  g.sel = RULES.chessColor(v.st.b[sq]) === myColor && v.legal.some((m) => m.f === sq) ? sq : null;
  g.promo = null;
  renderGames();
}

// Шашки: нажимаем шашку, потом поля по очереди (при взятии нескольких — каждое поле прыжка).
function checkersTap(sq) {
  const g = gMatch, v = g.view;
  if (!v.myTurn || g.over) return;
  if (g.sel) {
    const path = [...g.sel, sq];
    const fits = v.legal.filter((m) => path.every((x, i) => m.path[i] === x));
    if (fits.length) {
      const done = fits.find((m) => m.path.length === path.length);
      if (done && fits.length === 1) return sendMove({ path: done.path, taken: done.taken });
      g.sel = path;
      return renderGames();
    }
  }
  g.sel = v.legal.some((m) => m.path[0] === sq) ? [sq] : null;
  renderGames();
}

function showEmote(e, mine = false) {
  const text = EMOTES[e];
  if (!text || !gMatch) return;
  gMatch.emote = { text, mine };
  clearTimeout(gEmoteTimer);
  gEmoteTimer = setTimeout(() => {
    if (gMatch) gMatch.emote = null;
    gamesRerender();
  }, 3000);
  gamesRerender();
}

/* ---------- Фото профиля ---------- */

// Квадрат по центру фото → 96×96 JPEG. Так фото весит несколько КБ и быстро доходит до соперника.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 96, side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

document.addEventListener("change", async (e) => {
  if (e.target.id !== "g-photo" || !e.target.files?.[0]) return;
  gNickDraft = document.getElementById("g-nick")?.value ?? gNickDraft;
  try {
    gPhotoDraft = await shrinkPhoto(e.target.files[0]);
  } catch {
    toast("Seda pilti ei õnnestunud avada");
  }
  renderGames();
});

// Аватар: фото, если есть, иначе первая буква ника.
function avatarHtml(nick, photo) {
  return photo && /^data:image\//.test(photo)
    ? `<span class="g-avatar photo"><img src="${esc(photo)}" alt="" /></span>`
    : `<span class="g-avatar">${esc((nick || "?")[0].toUpperCase())}</span>`;
}

/* ---------- Экраны ---------- */

function onlineText() {
  if (!gConnected) return `<span class="g-online off">Ühendan…</span>`;
  return `<span class="g-online" data-gstat="online">${gStats ? gStats.online : "…"} võrgus</span>`;
}

function gameCountsText(id) {
  const s = gStats?.games?.[id];
  if (!s) return "";
  const parts = [];
  if (s.waiting) parts.push(`${s.waiting} ootab`);
  if (s.playing) parts.push(`${s.playing} mängib`);
  return parts.length ? parts.join(" · ") : "vaba";
}

// Обновить счётчики на месте — без перерисовки (чтобы не сбивать ввод и анимации).
function updateGameStats() {
  if (currentTab !== "games") return;
  const online = document.querySelector('[data-gstat="online"]');
  if (online && gStats) online.textContent = `${gStats.online} võrgus`;
  for (const el of document.querySelectorAll("[data-gstat-game]")) {
    const text = gameCountsText(el.dataset.gstatGame);
    el.textContent = text;
    el.classList.toggle("busy", text !== "vaba" && text !== "");
  }
}

function renderGames() {
  gamesOnRender();
  if (!state.games?.nick || gEditProfile) return (view.innerHTML = profileFormHtml());
  if (gMatch) return (view.innerHTML = matchHtml());
  if (gWaiting) {
    const info = gameInfo(gWaiting);
    view.innerHTML = `
      <div class="g-head"><h1 class="page-title">Mängud</h1>${onlineText()}</div>
      <section class="card g-search">
        <div class="g-search-icon">${info.icon}</div>
        <h2>Otsin vastast…</h2>
        <p class="muted">${esc(info.name)} · ${esc(schoolName(state.games.school))}</p>
        <div class="g-spinner" aria-hidden="true"></div>
        <p class="muted small" data-gstat-game="${info.id}">${gameCountsText(info.id)}</p>
        <button class="btn" data-action="g-cancel">Tühista</button>
      </section>
      <p class="page-lead">Kui keegi teine sinu koolist valib sama mängu, algab mäng kohe. Võid vahepeal teisi vahekaarte vaadata.</p>`;
    return;
  }
  view.innerHTML = `
    <div class="g-head"><h1 class="page-title">Mängud</h1>${onlineText()}</div>
    <section class="card g-profile">
      ${avatarHtml(state.games.nick, state.games.avatar)}
      <span class="grow"><b>${esc(state.games.nick)}</b><small>${esc(schoolName(state.games.school))}</small></span>
      <button class="btn small" data-action="g-edit-profile">Muuda</button>
    </section>
    <div class="g-grid">${GAME_LIST.map(
      (g) => `<button class="g-card" data-action="g-find" data-game="${g.id}" ${gConnected ? "" : "disabled"}>
        <span class="g-count" data-gstat-game="${g.id}">${gameCountsText(g.id)}</span>
        <span class="g-icon">${g.icon}</span>
        <b>${esc(g.name)}</b>
        <small>${esc(g.hint)}</small>
      </button>`
    ).join("")}</div>
    <p class="page-lead">Vajuta mängule — Kooly leiab vastase sinu koolist. Igaks käiguks on 3 minutit. Kui lahkud mängu ajal rakendusest, saad kaotuse.</p>`;
  updateGameStats();
}

function profileFormHtml() {
  const g = state.games || {};
  const photo = gPhotoDraft !== undefined ? gPhotoDraft : g.avatar || null;
  const nick = gNickDraft ?? g.nick ?? "";
  return `
    <h1 class="page-title">Mängud</h1>
    <section class="card g-setup">
      <div class="g-search-icon">🎮</div>
      <h2>${g.nick ? "Muuda profiili" : "Tere tulemast mängudesse!"}</h2>
      <p class="muted">Mängi male, kabet, trips-traps-trulli ja laevade pommitamist teiste õpilastega oma koolist.</p>
      <div class="g-photo-row">
        ${avatarHtml(nick || "?", photo).replace("g-avatar", "g-avatar big")}
        <span class="g-photo-actions">
          <label class="btn small">${photo ? "Vaheta fotot" : "Lisa foto"}<input id="g-photo" type="file" accept="image/*" hidden /></label>
          ${photo ? `<button class="btn small" data-action="g-photo-remove">Eemalda</button>` : ""}
        </span>
      </div>
      <p class="muted small">Fotot näeb ainult su vastane mängu ajal. Vali pilt, mida ei häbene ka õpetajale näidata 🙂</p>
      <label><span class="field-label">Hüüdnimi</span>
        <input class="input" id="g-nick" maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="nt Kooly123" value="${esc(nick)}" /></label>
      ${gNickError ? `<p class="g-error">${esc(gNickError)}</p>` : `<p class="muted small">3–16 märki. Teised näevad ainult hüüdnime.</p>`}
      <label><span class="field-label">Kool</span>
        <select class="input" id="g-school">${GAME_SCHOOLS.map((s) => `<option value="${s.id}" ${s.id === (g.school || GAME_SCHOOLS[0].id) ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <div class="actions">
        <button class="btn primary" data-action="g-save-profile">${g.nick ? "Salvesta" : "Alusta"}</button>
        ${g.nick ? `<button class="btn" data-action="g-cancel-profile">Loobu</button>` : ""}
      </div>
    </section>`;
}

function matchHtml() {
  const g = gMatch, v = g.view, info = gameInfo(g.game);
  let status;
  if (g.over) status = g.over.draw ? `🤝 Viik · ${esc(g.over.text)}` : g.over.win ? `🏆 Võitsid! · ${esc(g.over.text)}` : `Kaotasid · ${esc(g.over.text)}`;
  else if (g.game === "battleship" && !v.started) status = v.ready[g.seat] ? "Ootan, kuni vastane paigutab laevad…" : "Paiguta laevad ja vajuta „Valmis“";
  else if (g.game === "battleship" && v.waitingAnswer) status = "Lask…";
  else status = v.myTurn ? (v.check ? "Šahh! Sinu käik" : "Sinu käik") : v.check ? "Vastane on šahis — vastase käik" : "Vastase käik";

  const board =
    g.game === "chess" ? chessBoardHtml(g) : g.game === "checkers" ? checkersBoardHtml(g) : g.game === "tictactoe" ? tttHtml(g) : battleshipHtml(g);

  return `
    <div class="g-match ${g.over ? "over" : ""}">
      ${
        g.emote // реакция — крупно поверх доски, чтобы её точно заметили (и на iPhone, и на Android)
          ? `<div class="g-react ${g.emote.mine ? "mine" : ""}" aria-live="polite"><span class="g-react-e ${EMOTES.indexOf(g.emote.text) < 4 ? "big" : ""}">${esc(g.emote.text)}</span><small>${g.emote.mine ? "Sina" : esc(g.opp)}</small></div>`
          : ""
      }
      <div class="g-players">
        <span class="g-player opp ${!g.over && !v.myTurn ? "turn" : ""}">
          ${avatarHtml(g.opp, g.oppAvatar)}<b>${esc(g.opp)}</b>
          ${g.oppAway ? `<small class="g-away">ühenduseta…</small>` : ""}
        </span>
        <span class="g-vs">${info.icon} ${esc(info.name)}</span>
        <span class="g-player me ${!g.over && v.myTurn ? "turn" : ""}">
          <b>${esc(state.games.nick)}</b>${avatarHtml(state.games.nick, state.games.avatar)}
        </span>
      </div>
      <div class="g-status ${g.over ? (g.over.win ? "win" : g.over.draw ? "draw" : "lose") : v.myTurn ? "mine" : ""}">${status}</div>
      ${g.over ? "" : `<div class="g-clock" data-gclock ${clockText() ? "" : "hidden"}>${clockText()}</div>`}
      ${!gConnected && !g.over ? `<p class="g-error">Ühendus katkes — ühendan uuesti…</p>` : ""}
      ${g.oppAway && !g.over ? `<p class="muted small center">Vastane lahkus rakendusest. Kui ta 15 sekundi jooksul tagasi ei tule, võidad sina.</p>` : ""}
      ${board}
      ${
        g.over
          ? `${rematchHtml(g)}<div class="actions center"><button class="btn ${g.rematch === "offered" ? "" : "primary"}" data-action="g-again">Uus vastane</button><button class="btn" data-action="g-lobby">Mängud</button></div>`
          : `<div class="g-emotes">${EMOTES.map((e, i) => `<button data-action="g-emote" data-e="${i}">${esc(e)}</button>`).join("")}</div>
             <div class="actions center"><button class="btn small danger" data-action="g-resign">Anna alla</button></div>`
      }
    </div>`;
}

// Реванш с тем же соперником: предложить, ждать ответа, принять или отказаться.
function rematchHtml(g) {
  switch (g.rematch) {
    case "asked":
      return `<div class="g-rematch"><span>Ootan, kas ${esc(g.opp)} tahab kordusmängu…</span></div>`;
    case "offered":
      return `<div class="g-rematch offer"><span><b>${esc(g.opp)}</b> tahab kordusmängu!</span>
        <div class="actions center"><button class="btn primary" data-action="g-rematch">Nõustu</button><button class="btn" data-action="g-rematch-no">Keeldu</button></div></div>`;
    case "gone":
      return `<div class="g-rematch"><span>${esc(g.opp)} ei soovi kordusmängu</span></div>`;
    case "declined-by-me":
      return "";
    default:
      return `<div class="actions center"><button class="btn primary" data-action="g-rematch">🔁 Kordusmäng</button></div>`;
  }
}

/* --- Доски --- */

// Фигуры — рисунки lichess (pieces/, набор cburnett): одинаково выглядят на iPhone, Android и в браузере.
const pieceImg = (p, cls = "pc") => `<img class="${cls}" src="pieces/${RULES.chessColor(p)}${p.toUpperCase()}.svg" alt="" draggable="false" />`;

function boardOrder(seat) {
  const order = [...Array(64).keys()];
  return seat === 1 ? order.reverse() : order; // чёрные смотрят со своей стороны
}

function coordLabels(i, seat) {
  const r = i >> 3, c = i & 7;
  const edgeCol = seat === 1 ? 7 : 0, edgeRow = seat === 1 ? 0 : 7;
  return `${c === edgeCol ? `<i class="rank">${8 - r}</i>` : ""}${r === edgeRow ? `<i class="file">${"abcdefgh"[c]}</i>` : ""}`;
}

function chessBoardHtml(g) {
  const v = g.view, st = v.st;
  const targets = g.sel !== null ? new Set(v.legal.filter((m) => m.f === g.sel).map((m) => m.t)) : new Set();
  const kingSq = v.check ? st.b.indexOf(st.turn === "w" ? "K" : "k") : -1;
  // Взятые фигуры: чего не хватает по сравнению с началом.
  const start = { P: 8, N: 2, B: 2, R: 2, Q: 1 };
  const lost = (color) => {
    const out = [];
    for (const k of "QRBNP") {
      const have = st.b.filter((p) => p && p === (color === "w" ? k : k.toLowerCase())).length;
      for (let i = have; i < start[k]; i++) out.push(k);
    }
    return out;
  };
  const myColor = g.seat === 0 ? "w" : "b", oppColor = myColor === "w" ? "b" : "w";
  const capturedRow = (color) => `<div class="g-captured">${lost(color).map((k) => pieceImg(color === "w" ? k : k.toLowerCase(), "cp")).join("")}</div>`;
  return `
    ${capturedRow(myColor)}
    <div class="g-board chess">${boardOrder(g.seat)
      .map((i) => {
        const p = st.b[i];
        const dark = ((i >> 3) + (i & 7)) % 2 === 1;
        const cls = [dark ? "dk" : "lt", g.sel === i ? "g-sel" : "", st.last && (st.last.f === i || st.last.t === i) ? "g-last" : "", i === kingSq ? "g-check" : "", targets.has(i) ? (p ? "g-cap" : "g-dot") : ""].join(" ");
        return `<button class="sq ${cls}" data-action="g-sq" data-sq="${i}">${coordLabels(i, g.seat)}${p ? pieceImg(p) : ""}</button>`;
      })
      .join("")}
      ${
        g.promo
          ? `<div class="g-promo">${"QRBN".split("").map((k) => `<button data-action="g-promo" data-p="${k}">${pieceImg(myColor === "w" ? k : k.toLowerCase())}</button>`).join("")}</div>`
          : ""
      }
    </div>
    ${capturedRow(oppColor)}`;
}

function checkersBoardHtml(g) {
  const v = g.view, st = v.st;
  const sel = g.sel || [];
  const next = new Set(sel.length ? v.legal.filter((m) => sel.every((x, i) => m.path[i] === x)).map((m) => m.path[sel.length]).filter((x) => x !== undefined) : []);
  const movable = new Set(v.myTurn ? v.legal.map((m) => m.path[0]) : []);
  const mustCapture = v.myTurn && v.legal.some((m) => m.taken.length);
  const lastPath = new Set(st.last?.path || []);
  return `
    ${mustCapture ? `<p class="muted small center">Löömine on kohustuslik</p>` : ""}
    <div class="g-board checkers">${boardOrder(g.seat)
      .map((i) => {
        const p = st.b[i];
        const dark = ((i >> 3) + (i & 7)) % 2 === 1;
        const cls = [dark ? "dk" : "lt", sel.includes(i) ? "g-sel" : "", lastPath.has(i) ? "g-last" : "", next.has(i) ? "g-dot" : "", !sel.length && movable.has(i) && mustCapture ? "g-must" : ""].join(" ");
        return `<button class="sq ${cls}" data-action="g-sq" data-sq="${i}" ${dark ? "" : "disabled"}>${
          p ? `<span class="disc ${RULES.ckColor(p)} ${RULES.ckKing(p) ? "king" : ""}"></span>` : ""
        }</button>`;
      })
      .join("")}</div>`;
}

function tttHtml(g) {
  const v = g.view;
  const line = new Set(v.line || []);
  return `
    <p class="muted small center">Sina oled <b>${v.mark}</b></p>
    <div class="g-ttt">${v.cells
      .map((c, i) => `<button class="${c ? c.toLowerCase() : ""} ${line.has(i) ? "win" : ""}" data-action="g-ttt" data-i="${i}" ${c || !v.myTurn ? "disabled" : ""}>${c || ""}</button>`)
      .join("")}</div>`;
}

function battleshipHtml(g) {
  const v = g.view;
  const myCells = new Set(g.fleet.flat());
  const grid = (cls, cell) => `<div class="g-sea ${cls}">${Array.from({ length: 100 }, (_, i) => cell(i)).join("")}</div>`;
  const mine = grid("mine", (i) => {
    const shot = v.oppShots.get(i);
    return `<span class="${myCells.has(i) ? "ship" : ""} ${shot || ""}"></span>`;
  });
  if (!v.started) {
    return `
      <div class="g-sea-wrap"><h3>Sinu laevad</h3>${mine}</div>
      ${
        v.ready[g.seat]
          ? `<p class="muted center">Valmis! Ootan vastast…</p>`
          : `<div class="actions center"><button class="btn" data-action="g-bs-shuffle">Juhuslik paigutus</button><button class="btn primary" data-action="g-bs-ready">Valmis</button></div>`
      }`;
  }
  const target = grid(`target ${v.myTurn ? "active" : ""}`, (i) => {
    const shot = v.myShots.get(i);
    return shot ? `<span class="${shot}"></span>` : `<button data-action="g-shot" data-i="${i}" ${v.myTurn ? "" : "disabled"} aria-label="Lask"></button>`;
  });
  return `
    <div class="g-sea-wrap"><h3>Vastase meri</h3>${target}</div>
    <div class="g-sea-wrap small"><h3>Sinu laevad</h3>${mine}</div>`;
}
