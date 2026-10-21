"use strict";

/* =========================================================
   Правила игр «Mängud»: шахматы, шашки (русские), крестики-нолики, морской бой.
   Чистые функции без DOM. Сервер правила не проверяет — оба игрока считают их у себя,
   ход соперника принимается, только если он есть среди разрешённых.
   Доска 8×8: клетка i = строка*8 + столбец, строка 0 — верх (сторона чёрных).
   ========================================================= */

const RULES = (() => {
  const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

  /* ---------- Шахматы ---------- */
  // Фигуры: KQRBNP — белые, kqrbnp — чёрные. Ход: { f, t, p? (превращение: Q R B N), c? (рокировка), ep?, dbl? }

  const chessColor = (p) => (p ? (p === p.toUpperCase() ? "w" : "b") : null);

  function chessInit() {
    const back = "rnbqkbnr";
    const b = Array(64).fill(null);
    for (let c = 0; c < 8; c++) {
      b[c] = back[c];
      b[8 + c] = "p";
      b[48 + c] = "P";
      b[56 + c] = back[c].toUpperCase();
    }
    return { b, turn: "w", castle: "KQkq", ep: -1, half: 0, last: null };
  }

  function attacked(b, sq, by) {
    const r = sq >> 3, c = sq & 7;
    const w = by === "w";
    const pr = w ? r + 1 : r - 1;
    for (const dc of [-1, 1]) if (inb(pr, c + dc) && b[pr * 8 + c + dc] === (w ? "P" : "p")) return true;
    for (const [dr, dc] of KNIGHT) if (inb(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === (w ? "N" : "n")) return true;
    for (const [dr, dc] of [...DIAG, ...ORTH]) if (inb(r + dr, c + dc) && b[(r + dr) * 8 + c + dc] === (w ? "K" : "k")) return true;
    const slide = (dirs, kinds) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inb(rr, cc)) {
          const p = b[rr * 8 + cc];
          if (p) {
            if (chessColor(p) === by && kinds.includes(p.toUpperCase())) return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
      return false;
    };
    return slide(DIAG, "BQ") || slide(ORTH, "RQ");
  }

  function chessPseudo(st) {
    const out = [], b = st.b, me = st.turn, foe = me === "w" ? "b" : "w";
    const enemy = (q) => q && chessColor(q) !== me;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || chessColor(p) !== me) continue;
      const r = i >> 3, c = i & 7, kind = p.toUpperCase();
      const add = (t, extra) => out.push({ f: i, t, ...extra });
      if (kind === "P") {
        const dir = me === "w" ? -1 : 1, start = me === "w" ? 6 : 1, last = me === "w" ? 0 : 7;
        const push = (t, extra) => {
          if (t >> 3 === last) for (const pr of "QRBN") add(t, { ...extra, p: pr });
          else add(t, extra);
        };
        if (inb(r + dir, c) && !b[(r + dir) * 8 + c]) {
          push((r + dir) * 8 + c);
          if (r === start && !b[(r + 2 * dir) * 8 + c]) add((r + 2 * dir) * 8 + c, { dbl: 1 });
        }
        for (const dc of [-1, 1]) {
          if (!inb(r + dir, c + dc)) continue;
          const t = (r + dir) * 8 + c + dc;
          if (enemy(b[t])) push(t);
          else if (t === st.ep) add(t, { ep: 1 });
        }
      } else if (kind === "N" || kind === "K") {
        for (const [dr, dc] of kind === "N" ? KNIGHT : [...DIAG, ...ORTH]) {
          if (!inb(r + dr, c + dc)) continue;
          const t = (r + dr) * 8 + c + dc;
          if (!b[t] || enemy(b[t])) add(t);
        }
        if (kind === "K") {
          const home = me === "w" ? 60 : 4, [K, Q, R] = me === "w" ? ["K", "Q", "R"] : ["k", "q", "r"];
          if (i === home && !attacked(b, home, foe)) {
            if (st.castle.includes(K) && !b[home + 1] && !b[home + 2] && b[home + 3] === R && !attacked(b, home + 1, foe) && !attacked(b, home + 2, foe))
              add(home + 2, { c: "K" });
            if (st.castle.includes(Q) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === R && !attacked(b, home - 1, foe) && !attacked(b, home - 2, foe))
              add(home - 2, { c: "Q" });
          }
        }
      } else {
        const dirs = kind === "B" ? DIAG : kind === "R" ? ORTH : [...DIAG, ...ORTH];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (inb(rr, cc)) {
            const t = rr * 8 + cc;
            if (b[t]) {
              if (enemy(b[t])) add(t);
              break;
            }
            add(t);
            rr += dr;
            cc += dc;
          }
        }
      }
    }
    return out;
  }

  function chessApply(st, mv) {
    const b = st.b.slice(), me = st.turn, p = b[mv.f];
    let captured = b[mv.t];
    b[mv.t] = mv.p ? (me === "w" ? mv.p : mv.p.toLowerCase()) : p;
    b[mv.f] = null;
    if (mv.ep) {
      const sq = mv.t + (me === "w" ? 8 : -8);
      captured = b[sq];
      b[sq] = null;
    }
    if (mv.c) {
      const home = me === "w" ? 60 : 4;
      const [from, to] = mv.c === "K" ? [home + 3, home + 1] : [home - 4, home - 1];
      b[to] = b[from];
      b[from] = null;
    }
    let castle = st.castle;
    if (p === "K") castle = castle.replace("K", "").replace("Q", "");
    if (p === "k") castle = castle.replace("k", "").replace("q", "");
    for (const [sq, ch] of [[63, "K"], [56, "Q"], [7, "k"], [0, "q"]]) if (mv.f === sq || mv.t === sq) castle = castle.replace(ch, "");
    return {
      b,
      turn: me === "w" ? "b" : "w",
      castle,
      ep: mv.dbl ? (mv.f + mv.t) / 2 : -1,
      half: p.toUpperCase() === "P" || captured ? 0 : st.half + 1,
      last: { f: mv.f, t: mv.t },
      captured,
    };
  }

  function chessLegal(st) {
    return chessPseudo(st).filter((mv) => {
      const n = chessApply(st, mv);
      return !attacked(n.b, n.b.indexOf(st.turn === "w" ? "K" : "k"), n.turn);
    });
  }

  function chessInCheck(st) {
    return attacked(st.b, st.b.indexOf(st.turn === "w" ? "K" : "k"), st.turn === "w" ? "b" : "w");
  }

  // null — игра идёт; иначе { winner: "w"|"b"|null, reason }
  function chessResult(st) {
    if (!chessLegal(st).length) return chessInCheck(st) ? { winner: st.turn === "w" ? "b" : "w", reason: "mate" } : { winner: null, reason: "stalemate" };
    const rest = st.b.filter((p) => p && p.toUpperCase() !== "K");
    if (!rest.length || (rest.length === 1 && "BN".includes(rest[0].toUpperCase()))) return { winner: null, reason: "material" };
    if (st.half >= 100) return { winner: null, reason: "fifty" };
    return null;
  }

  const chessSame = (a, b) => a.f === b.f && a.t === b.t && (a.p || null) === (b.p || null);

  /* ---------- Шашки (русские правила) ---------- */
  // w/b — простые, W/B — дамки. Белые внизу и ходят первыми. Бить обязательно (можно назад),
  // дамка «дальнобойная», побитые шашки снимаются после хода (турецкий удар запрещён),
  // простая, дойдя до последней линии во время боя, становится дамкой и бьёт дальше.
  // Ход: { path: [клетки по порядку], taken: [побитые] }

  const ckColor = (p) => (p ? p.toLowerCase() : null);
  const ckKing = (p) => p && p === p.toUpperCase();

  function checkersInit() {
    const b = Array(64).fill(null);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) b[r * 8 + c] = r < 3 ? "b" : r > 4 ? "w" : null;
    return { b, turn: "w", last: null };
  }

  function ckCaptures(b, from, me) {
    const out = [];
    const promoRow = me === "w" ? 0 : 7;
    const jumps = (board, pos, king, taken) => {
      const res = [];
      const r = pos >> 3, c = pos & 7;
      for (const [dr, dc] of DIAG) {
        if (king) {
          let rr = r + dr, cc = c + dc;
          while (inb(rr, cc) && !board[rr * 8 + cc]) (rr += dr), (cc += dc);
          if (!inb(rr, cc)) continue;
          const mid = rr * 8 + cc;
          if (ckColor(board[mid]) === me || taken.includes(mid)) continue;
          const lands = [];
          let r2 = rr + dr, c2 = cc + dc;
          while (inb(r2, c2) && !board[r2 * 8 + c2]) lands.push(r2 * 8 + c2), (r2 += dr), (c2 += dc);
          for (const land of lands) res.push({ mid, land, king: true });
        } else {
          const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
          if (!inb(r2, c2)) continue;
          const mid = r1 * 8 + c1, land = r2 * 8 + c2;
          if (board[mid] && ckColor(board[mid]) !== me && !taken.includes(mid) && !board[land]) res.push({ mid, land, king: r2 === promoRow });
        }
      }
      return res;
    };
    const dfs = (board, pos, king, path, taken) => {
      let options = jumps(board, pos, king, taken);
      // Дамка обязана встать туда, откуда можно бить дальше (если такое поле есть в этом направлении).
      const groups = new Map();
      for (const o of options) groups.set(o.mid, [...(groups.get(o.mid) || []), o]);
      options = [];
      for (const group of groups.values()) {
        const next = group.filter((o) => {
          const nb = board.slice();
          nb[o.land] = nb[pos];
          nb[pos] = null;
          return jumps(nb, o.land, o.king, [...taken, o.mid]).length > 0;
        });
        options.push(...(next.length ? next : group));
      }
      if (!options.length) {
        if (path.length > 1) out.push({ path, taken });
        return;
      }
      for (const o of options) {
        const nb = board.slice();
        nb[o.land] = nb[pos];
        nb[pos] = null;
        dfs(nb, o.land, o.king, [...path, o.land], [...taken, o.mid]);
      }
    };
    dfs(b, from, ckKing(b[from]), [from], []);
    return out;
  }

  function checkersLegal(st) {
    const b = st.b, me = st.turn, caps = [], steps = [];
    for (let i = 0; i < 64; i++) {
      if (ckColor(b[i]) !== me) continue;
      caps.push(...ckCaptures(b, i, me));
      if (caps.length) continue;
      const r = i >> 3, c = i & 7;
      for (const [dr, dc] of DIAG) {
        if (ckKing(b[i])) {
          let rr = r + dr, cc = c + dc;
          while (inb(rr, cc) && !b[rr * 8 + cc]) steps.push({ path: [i, rr * 8 + cc], taken: [] }), (rr += dr), (cc += dc);
        } else if (dr === (me === "w" ? -1 : 1) && inb(r + dr, c + dc) && !b[(r + dr) * 8 + c + dc]) {
          steps.push({ path: [i, (r + dr) * 8 + c + dc], taken: [] });
        }
      }
    }
    return caps.length ? caps : steps;
  }

  function checkersApply(st, mv) {
    const b = st.b.slice(), me = st.turn;
    const from = mv.path[0], to = mv.path[mv.path.length - 1];
    let piece = b[from];
    b[from] = null;
    for (const t of mv.taken) b[t] = null;
    const promoRow = me === "w" ? 0 : 7;
    if (mv.path.slice(1).some((sq) => sq >> 3 === promoRow)) piece = piece.toUpperCase();
    b[to] = piece;
    return { b, turn: me === "w" ? "b" : "w", last: { path: mv.path, taken: mv.taken } };
  }

  function checkersResult(st) {
    return checkersLegal(st).length ? null : { winner: st.turn === "w" ? "b" : "w", reason: "nomoves" };
  }

  const checkersSame = (a, b) => a.path.length === b.path.length && a.path.every((x, i) => x === b.path[i]) && a.taken.length === b.taken.length;

  /* ---------- Крестики-нолики ---------- */

  const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  function tttResult(cells) {
    for (const line of LINES) {
      const [a, b, c] = line;
      if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return { winner: cells[a], line };
    }
    return cells.every(Boolean) ? { winner: null } : null;
  }

  /* ---------- Морской бой ---------- */
  // Поле 10×10, флот 4+3+3+2+2+2+1+1+1+1, корабли не касаются даже углами. Попал — стреляешь ещё раз.

  const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

  function randomFleet() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const busy = new Set();
      const ships = [];
      let ok = true;
      for (const size of FLEET) {
        let placed = false;
        for (let k = 0; k < 300 && !placed; k++) {
          const horiz = Math.random() < 0.5;
          const r = Math.floor(Math.random() * (horiz ? 10 : 11 - size));
          const c = Math.floor(Math.random() * (horiz ? 11 - size : 10));
          const cells = Array.from({ length: size }, (_, j) => (horiz ? r * 10 + c + j : (r + j) * 10 + c));
          if (cells.some((x) => busy.has(x))) continue;
          ships.push(cells);
          for (const x of cells) {
            const xr = Math.floor(x / 10), xc = x % 10;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (xr + dr >= 0 && xr + dr < 10 && xc + dc >= 0 && xc + dc < 10) busy.add((xr + dr) * 10 + xc + dc);
          }
          placed = true;
        }
        if (!placed) {
          ok = false;
          break;
        }
      }
      if (ok) return ships;
    }
    return null;
  }

  // Ответ на выстрел по моему флоту (shotsAtMe — клетки, куда уже стреляли, включая этот выстрел).
  function answerShot(ships, shotsAtMe, i) {
    const ship = ships.find((s) => s.includes(i));
    if (!ship) return { i, hit: false };
    const sunk = ship.every((x) => shotsAtMe.has(x));
    const lose = ships.every((s) => s.every((x) => shotsAtMe.has(x)));
    return { i, hit: true, sunk: sunk ? ship : null, lose };
  }

  // Клетки вокруг потопленного корабля — там точно пусто.
  function around(ship) {
    const out = new Set();
    for (const x of ship) {
      const r = Math.floor(x / 10), c = x % 10;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < 10 && cc >= 0 && cc < 10 && !ship.includes(rr * 10 + cc)) out.add(rr * 10 + cc);
      }
    }
    return [...out];
  }

  return {
    chessInit, chessLegal, chessApply, chessResult, chessInCheck, chessSame, chessColor,
    checkersInit, checkersLegal, checkersApply, checkersResult, checkersSame, ckColor, ckKing,
    tttResult, FLEET, randomFleet, answerShot, around,
  };
})();

if (typeof module !== "undefined") module.exports = RULES;
