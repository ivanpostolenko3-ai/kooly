// Kooly «Mängud» — онлайн-игры с учениками своей школы.
// Один Durable Object на школу (idFromName(школа)): держит WebSocket-соединения, ищет соперника,
// передаёт ходы и считает, сколько людей ждёт и играет. Правила игр проверяют сами клиенты (games-rules.js),
// сервер только соединяет и хранит список ходов, чтобы после обрыва связи игру можно было продолжить.
//
// Клиент → сервер: hello {pid, nick, avatar?} · avatar {a} · find {game} · cancel · move {m, turn} · end · resign · emote {e} · away · back
//                  rematch {room} · rematch-no {room}   (реванш с тем же соперником после партии)
// Сервер → клиент: stats {online, games} · waiting {game} · matched {room, game, seat, opp, oppAvatar} · resume {…, moves}
//                  rematch-ask · rematch-no · rematch-gone · move {m} · clock {turn, left} · opp-away · opp-back · opp-left {reason} · lost {reason} · draw {reason} · emote {e} · error {code}
//
// Время: на ход 3 минуты (TURN_LIMIT) — не успел, поражение. Ушёл из приложения — поражение через 15 секунд
// (короткий запас — на случай, если просто моргнул интернет). Чей ход, сообщает клиент в move.turn (-1 — ходят оба: расстановка кораблей).

import { DurableObject } from "cloudflare:workers";

export const GAMES = ["chess", "checkers", "tictactoe", "battleship"];
const AWAY_GRACE = 15_000; // вышел из приложения или пропала связь — 15 секунд на возвращение, потом поражение
const TURN_LIMIT = 180_000; // 3 минуты на ход
const MAX_MOVES = 3000;
const EMOTES = 6;
// Фото профиля: маленький JPEG 96×96, который приложение само уменьшает (обычно 3–6 КБ).
const MAX_AVATAR = 16_000;
const validAvatar = (a) => typeof a === "string" && a.length <= MAX_AVATAR && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a);

// Грубые слова в никах (ru/et/en, корни) — проверяется и в приложении.
const BAD = /(хуй|хуе|хуё|пизд|бля|еба|ёба|ебл|сука|залуп|мудак|пидор|пидар|гандон|fuck|shit|bitch|cunt|nigg|fag|dick|pussy|türa|tura|munn|perse|vitt|lits|pede|hoor)/i;

export function cleanNick(raw) {
  const nick = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (nick.length < 3 || !/^[\p{L}\p{N} _.-]+$/u.test(nick) || BAD.test(nick.replace(/[\s_.-]/g, ""))) return null;
  return nick;
}

export class GameLobby extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.statsTimer = null;
  }

  async fetch() {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]); // с «засыпанием»: пока все молчат, объект не тратит лимит
    pair[1].serializeAttachment({ pid: null, nick: "", status: "idle", game: null, room: null });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // MARK: Сокеты

  att(ws) {
    return ws.deserializeAttachment() || {};
  }

  setAtt(ws, patch) {
    ws.serializeAttachment({ ...this.att(ws), ...patch });
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // сокет уже закрыт
    }
  }

  sockets() {
    return this.ctx.getWebSockets();
  }

  byPid(pid) {
    return this.sockets().filter((ws) => this.att(ws).pid === pid);
  }

  sendTo(pid, msg) {
    for (const ws of this.byPid(pid)) this.send(ws, msg);
  }

  // MARK: Сообщения

  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > MAX_AVATAR + 2000) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const a = this.att(ws);
    if (m.t !== "hello" && !a.pid) return;

    switch (m.t) {
      case "hello": {
        const pid = String(m.pid || "");
        const nick = cleanNick(m.nick);
        if (!/^[a-z0-9]{12,40}$/.test(pid)) return this.send(ws, { t: "error", code: "pid" });
        if (!nick) return this.send(ws, { t: "error", code: "nick" });
        // Kooly открыт второй раз (другая вкладка) — старое соединение закрываем.
        for (const old of this.byPid(pid)) {
          if (old === ws) continue;
          old.serializeAttachment({ pid: null, nick: "", status: "idle", game: null, room: null });
          try {
            old.close(4000, "replaced");
          } catch {
            // уже закрыт
          }
        }
        this.setAtt(ws, { pid, nick, status: "idle", game: null, room: null });
        await this.saveAvatar(pid, m.avatar);
        // Партия закончилась, пока его не было (время вышло, соперник сдался) — сообщить итог.
        const last = (await this.ctx.storage.get("x:" + pid)) || null;
        if (last) await this.ctx.storage.delete("x:" + pid);
        this.send(ws, { t: "hi", last });
        await this.resume(ws, pid);
        break;
      }
      case "find": {
        if (a.status === "playing" || !GAMES.includes(m.game)) return;
        const opp = this.sockets().find((o) => {
          if (o === ws) return false;
          const oa = this.att(o);
          return oa.status === "waiting" && oa.game === m.game && oa.pid !== a.pid;
        });
        if (opp) await this.startRoom(m.game, opp, ws);
        else {
          this.setAtt(ws, { status: "waiting", game: m.game });
          this.send(ws, { t: "waiting", game: m.game });
        }
        break;
      }
      case "avatar":
        await this.saveAvatar(a.pid, m.a);
        break;
      case "cancel":
        if (a.status === "waiting") this.setAtt(ws, { status: "idle", game: null });
        break;
      case "move": {
        const room = await this.room(a.room);
        if (!room || room.over || room.moves.length >= MAX_MOVES) return;
        const seat = room.pids.indexOf(a.pid);
        if (seat < 0) return;
        room.moves.push({ s: seat, m: m.m });
        if ([-1, 0, 1].includes(m.turn)) {
          room.turn = m.turn;
          room.turnAt = Date.now();
        }
        await this.ctx.storage.put("r:" + room.id, room);
        this.sendTo(room.pids[1 - seat], { t: "move", s: seat, m: m.m });
        this.sendClock(room);
        await this.scheduleAlarm();
        break;
      }
      case "away": // ушёл из приложения (свернул, заблокировал телефон) — 15 секунд на возвращение
      case "back": {
        if (m.t === "away" && a.status === "waiting") this.setAtt(ws, { status: "idle", game: null }); // не соединять с ушедшим
        const room = await this.room(a.room);
        if (!room || room.over) return;
        const seat = room.pids.indexOf(a.pid);
        room.away[seat] = m.t === "away" ? Date.now() : 0;
        await this.ctx.storage.put("r:" + room.id, room);
        this.sendTo(room.pids[1 - seat], m.t === "away" ? { t: "opp-away", grace: AWAY_GRACE } : { t: "opp-back" });
        if (m.t === "away") await this.scheduleAlarm();
        break;
      }
      case "rematch": {
        // Реванш: оба нажали «Kordusmäng» — новая партия с тем же соперником, первым ходит тот, кто был вторым.
        const rec = await this.ctx.storage.get("m:" + m.room);
        const seat = rec ? rec.pids.indexOf(a.pid) : -1;
        const otherPid = rec && rec.pids[1 - seat];
        const other = otherPid && this.byPid(otherPid).find((o) => this.att(o).status !== "playing");
        if (seat < 0 || !other || a.status === "playing") {
          this.send(ws, { t: "rematch-gone" });
          break;
        }
        rec.want[seat] = true;
        if (rec.want[1 - seat]) {
          await this.ctx.storage.delete("m:" + m.room);
          if (this.att(other).status === "waiting") this.setAtt(other, { status: "idle", game: null });
          const [s0, s1] = seat === 0 ? [other, ws] : [ws, other]; // прошлый второй (seat 1) теперь первый
          await this.startRoom(rec.game, s0, s1, true);
        } else {
          await this.ctx.storage.put("m:" + m.room, rec);
          this.sendTo(otherPid, { t: "rematch-ask", room: m.room });
        }
        break;
      }
      case "rematch-no": {
        const rec = await this.ctx.storage.get("m:" + m.room);
        const seat = rec ? rec.pids.indexOf(a.pid) : -1;
        if (seat < 0) break;
        await this.ctx.storage.delete("m:" + m.room);
        this.sendTo(rec.pids[1 - seat], { t: "rematch-no", room: m.room });
        break;
      }
      case "emote": {
        const room = await this.room(a.room);
        const e = Number(m.e);
        if (!room || !Number.isInteger(e) || e < 0 || e >= EMOTES) return;
        this.sendTo(room.pids[1 - room.pids.indexOf(a.pid)], { t: "emote", e });
        break;
      }
      case "end": // партия закончилась по правилам (мат, ничья, все корабли потоплены) — это видят оба клиента
        await this.finish(a.room, null);
        break;
      case "resign": {
        const room = await this.room(a.room);
        if (room && !room.over) await this.finish(room.id, { pid: room.pids[1 - room.pids.indexOf(a.pid)], reason: "resign" });
        break;
      }
      default:
        return;
    }
    this.scheduleStats();
  }

  async webSocketClose(ws) {
    await this.gone(ws);
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  // Соединение пропало. Если шла игра — ждём возвращения, соперник видит «нет связи».
  async gone(ws) {
    const a = this.att(ws);
    ws.serializeAttachment({ pid: null, nick: "", status: "idle", game: null, room: null });
    if (a.pid && a.status === "playing" && a.room && !this.byPid(a.pid).length) {
      const room = await this.room(a.room);
      if (room && !room.over) {
        const seat = room.pids.indexOf(a.pid);
        room.away[seat] = Date.now();
        await this.ctx.storage.put("r:" + room.id, room);
        this.sendTo(room.pids[1 - seat], { t: "opp-away", grace: AWAY_GRACE });
        await this.scheduleAlarm();
      }
    }
    this.scheduleStats();
  }

  // Переподключился — вернуть в незаконченную игру со всеми ходами.
  async resume(ws, pid) {
    const roomId = await this.ctx.storage.get("p:" + pid);
    const room = roomId && (await this.room(roomId));
    if (!room || room.over) return;
    const seat = room.pids.indexOf(pid);
    room.away[seat] = 0;
    await this.ctx.storage.put("r:" + room.id, room);
    this.setAtt(ws, { status: "playing", game: room.game, room: room.id });
    const oppAvatar = (await this.ctx.storage.get("a:" + room.pids[1 - seat])) || null;
    this.send(ws, { t: "resume", room: room.id, game: room.game, seat, opp: room.nicks[1 - seat], oppAvatar, moves: room.moves, clock: this.clock(room) });
    this.sendTo(room.pids[1 - seat], { t: "opp-back" });
  }

  // undefined — не трогаем, null/"" — удалить фото, строка — новое фото (если это правда маленькая картинка).
  async saveAvatar(pid, avatar) {
    if (avatar === undefined || !pid) return;
    if (validAvatar(avatar)) await this.ctx.storage.put("a:" + pid, avatar);
    else if (!avatar) await this.ctx.storage.delete("a:" + pid);
  }

  // MARK: Партии

  async room(id) {
    return id ? await this.ctx.storage.get("r:" + id) : null;
  }

  async startRoom(game, wsA, wsB, fixedOrder = false) {
    const [s0, s1] = fixedOrder || Math.random() < 0.5 ? [wsA, wsB] : [wsB, wsA]; // кто ходит первым — случайно (кроме реванша)
    const a0 = this.att(s0), a1 = this.att(s1);
    const room = {
      id: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
      game,
      pids: [a0.pid, a1.pid],
      nicks: [a0.nick, a1.nick],
      moves: [],
      away: [0, 0],
      over: false,
      created: Date.now(),
      turn: game === "battleship" ? -1 : 0, // в морском бое сначала оба расставляют корабли
      turnAt: Date.now(),
    };
    await this.ctx.storage.put({ ["r:" + room.id]: room, ["p:" + a0.pid]: room.id, ["p:" + a1.pid]: room.id });
    const avatars = await this.ctx.storage.get(["a:" + a0.pid, "a:" + a1.pid]);
    for (const [seat, ws] of [s0, s1].entries()) {
      this.setAtt(ws, { status: "playing", game, room: room.id });
      const oppAvatar = avatars.get("a:" + room.pids[1 - seat]) || null;
      this.send(ws, { t: "matched", room: room.id, game, seat, opp: room.nicks[1 - seat], oppAvatar, clock: this.clock(room) });
    }
    await this.scheduleAlarm();
  }

  clock(room) {
    return { turn: room.turn ?? null, left: Math.max(0, TURN_LIMIT - (Date.now() - (room.turnAt || Date.now()))) };
  }

  sendClock(room) {
    const msg = { t: "clock", ...this.clock(room) };
    for (const pid of room.pids) this.sendTo(pid, msg);
  }

  // win: { pid, reason } — кому присудить победу (сдача, время вышло, ушёл из приложения); null — по правилам.
  async finish(id, win) {
    const room = await this.room(id);
    if (!room) return;
    room.over = true;
    await this.ctx.storage.delete(["r:" + room.id, "p:" + room.pids[0], "p:" + room.pids[1]]);
    // Запомнить пару для реванша (на 10 минут).
    await this.ctx.storage.put("m:" + room.id, { game: room.game, pids: room.pids, want: [false, false], at: Date.now() });
    for (const pid of room.pids) {
      for (const ws of this.byPid(pid)) if (this.att(ws).room === room.id) this.setAtt(ws, { status: "idle", game: null, room: null });
    }
    if (!win) return;
    const loser = room.pids.find((p) => p !== win.pid);
    this.sendTo(win.pid, { t: "opp-left", reason: win.reason });
    this.sendTo(loser, { t: "lost", reason: win.reason });
    // Кого сейчас нет на связи — узнает итог, когда вернётся (hello → last).
    if (!this.byPid(win.pid).length) await this.ctx.storage.put("x:" + win.pid, { room: room.id, win: true, reason: win.reason });
    if (!this.byPid(loser).length) await this.ctx.storage.put("x:" + loser, { room: room.id, win: false, reason: win.reason });
  }

  // Будильник — на ближайший срок: конец времени на ход или конец 15 секунд после ухода из приложения.
  async scheduleAlarm() {
    let next = Infinity;
    for (const room of (await this.ctx.storage.list({ prefix: "r:" })).values()) {
      if (room.over) continue;
      if (room.turn !== null && room.turn !== undefined) next = Math.min(next, room.turnAt + TURN_LIMIT);
      for (const t of room.away) if (t) next = Math.min(next, t + AWAY_GRACE);
    }
    if (next < Infinity) await this.ctx.storage.setAlarm(next + 500);
  }

  // Будильник: время на ход вышло или игрок не вернулся в приложение — поражение. Заодно чистим брошенные партии.
  async alarm() {
    const now = Date.now();
    for (const room of (await this.ctx.storage.list({ prefix: "r:" })).values()) {
      if (room.over) continue;
      const gone = [0, 1].filter((s) => room.away[s] && now - room.away[s] >= AWAY_GRACE);
      const timedOut = room.turn !== null && room.turn !== undefined && now - room.turnAt >= TURN_LIMIT;
      if (gone.length === 2 || (timedOut && room.turn === -1)) {
        // Ушли оба или никто не расставил корабли — партия без победителя.
        for (const pid of room.pids) this.sendTo(pid, { t: "draw", reason: gone.length === 2 ? "left" : "timeout" });
        await this.finish(room.id, null);
      } else if (gone.length === 1) {
        await this.finish(room.id, { pid: room.pids[1 - gone[0]], reason: "disconnect" });
      } else if (timedOut) {
        await this.finish(room.id, { pid: room.pids[1 - room.turn], reason: "timeout" });
      } else if (now - room.created > 24 * 3600_000 && !room.pids.some((p) => this.byPid(p).length)) {
        await this.finish(room.id, null);
      }
    }
    // Старые предложения реванша — убрать.
    for (const [key, rec] of await this.ctx.storage.list({ prefix: "m:" })) if (now - rec.at > 10 * 60_000) await this.ctx.storage.delete(key);
    await this.scheduleAlarm();
    this.scheduleStats();
  }

  // MARK: Сколько людей онлайн — всем, кто открыл «Mängud»

  scheduleStats() {
    if (this.statsTimer) return;
    this.statsTimer = setTimeout(() => {
      this.statsTimer = null;
      const games = Object.fromEntries(GAMES.map((g) => [g, { waiting: 0, playing: 0 }]));
      const online = new Set();
      for (const ws of this.sockets()) {
        const a = this.att(ws);
        if (!a.pid) continue;
        online.add(a.pid);
        if (a.status === "waiting" && games[a.game]) games[a.game].waiting++;
        if (a.status === "playing" && games[a.game]) games[a.game].playing++;
      }
      const msg = JSON.stringify({ t: "stats", online: online.size, games });
      for (const ws of this.sockets()) {
        try {
          if (this.att(ws).pid) ws.send(msg);
        } catch {
          // закрыт
        }
      }
    }, 300);
  }
}
