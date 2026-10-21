// Kooly «Mängud» — онлайн-игры с учениками своей школы.
// Один Durable Object на школу (idFromName(школа)): держит WebSocket-соединения, ищет соперника,
// передаёт ходы и считает, сколько людей ждёт и играет. Правила игр проверяют сами клиенты (games-rules.js),
// сервер только соединяет и хранит список ходов, чтобы после обрыва связи игру можно было продолжить.
//
// Клиент → сервер: hello {pid, nick} · find {game} · cancel · move {m} · end · resign · emote {e}
// Сервер → клиент: stats {online, games} · waiting {game} · matched {room, game, seat, opp} · resume {…, moves}
//                  move {m} · opp-away · opp-back · opp-left {reason} · emote {e} · error {code}

import { DurableObject } from "cloudflare:workers";

export const GAMES = ["chess", "checkers", "tictactoe", "battleship"];
const AWAY_GRACE = 90_000; // соперник пропал (закрыл приложение) — ждём его полторы минуты, потом победа
const MAX_MOVES = 3000;
const EMOTES = 6;

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
    if (typeof raw !== "string" || raw.length > 6000) return;
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
        this.send(ws, { t: "hi" });
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
      case "cancel":
        if (a.status === "waiting") this.setAtt(ws, { status: "idle", game: null });
        break;
      case "move": {
        const room = await this.room(a.room);
        if (!room || room.over || room.moves.length >= MAX_MOVES) return;
        const seat = room.pids.indexOf(a.pid);
        if (seat < 0) return;
        room.moves.push({ s: seat, m: m.m });
        await this.ctx.storage.put("r:" + room.id, room);
        this.sendTo(room.pids[1 - seat], { t: "move", s: seat, m: m.m });
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
        const alarm = await this.ctx.storage.getAlarm();
        if (!alarm) await this.ctx.storage.setAlarm(Date.now() + AWAY_GRACE + 1000);
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
    this.send(ws, { t: "resume", room: room.id, game: room.game, seat, opp: room.nicks[1 - seat], moves: room.moves });
    this.sendTo(room.pids[1 - seat], { t: "opp-back" });
  }

  // MARK: Партии

  async room(id) {
    return id ? await this.ctx.storage.get("r:" + id) : null;
  }

  async startRoom(game, wsA, wsB) {
    const [s0, s1] = Math.random() < 0.5 ? [wsA, wsB] : [wsB, wsA]; // кто ходит первым — случайно
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
    };
    await this.ctx.storage.put({ ["r:" + room.id]: room, ["p:" + a0.pid]: room.id, ["p:" + a1.pid]: room.id });
    for (const [seat, ws] of [s0, s1].entries()) {
      this.setAtt(ws, { status: "playing", game, room: room.id });
      this.send(ws, { t: "matched", room: room.id, game, seat, opp: room.nicks[1 - seat] });
    }
  }

  // win: { pid, reason } — кому присудить победу (сдача, соперник не вернулся); null — партия кончилась по правилам.
  async finish(id, win) {
    const room = await this.room(id);
    if (!room) return;
    room.over = true;
    await this.ctx.storage.delete(["r:" + room.id, "p:" + room.pids[0], "p:" + room.pids[1]]);
    for (const pid of room.pids) {
      for (const ws of this.byPid(pid)) if (this.att(ws).room === room.id) this.setAtt(ws, { status: "idle", game: null, room: null });
    }
    if (win) this.sendTo(win.pid, { t: "opp-left", reason: win.reason });
  }

  // Будильник: соперник не вернулся за полторы минуты — победа оставшемуся. Заодно чистим брошенные партии.
  async alarm() {
    const now = Date.now();
    let next = 0;
    const rooms = await this.ctx.storage.list({ prefix: "r:" });
    for (const room of rooms.values()) {
      const awaySeat = room.away.findIndex((t) => t > 0);
      if (room.away[0] && room.away[1]) {
        if (now - Math.max(...room.away) >= AWAY_GRACE) await this.finish(room.id, null); // ушли оба
        else next = next || now + AWAY_GRACE;
      } else if (awaySeat >= 0) {
        if (now - room.away[awaySeat] >= AWAY_GRACE) await this.finish(room.id, { pid: room.pids[1 - awaySeat], reason: "disconnect" });
        else next = Math.min(next || Infinity, room.away[awaySeat] + AWAY_GRACE + 1000);
      } else if (now - room.created > 24 * 3600_000 && !room.pids.some((p) => this.byPid(p).length)) {
        await this.finish(room.id, null);
      }
    }
    if (next) await this.ctx.storage.setAlarm(next);
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
