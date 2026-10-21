"use strict";

/* =========================================================
   Edenemine — аналитика оценок из Stuudium.
   Оценки в процентах (0–100) + «AR» (arvestatud, зачёт без балла).
   Данные приходят вместе с домашкой: state.grades = { period, subjects, courses, updatedAt }.
   ========================================================= */

let progressSubject = null; // открытый предмет (имя) или null — обзор

// Периоды статистики. «Periood» — текущий период Stuudium как есть; остальные — из архива всех оценок,
// которые Kooly видел (Stuudium показывает только текущий период, поэтому архив копится с каждой синхронизацией).
const PROGRESS_RANGES = [
  { id: "period", label: "Periood" },
  { id: "1m", label: "Kuu", days: 30, lead: "viimane kuu" },
  { id: "6m", label: "Pool aastat", days: 183, lead: "viimased pool aastat" },
  { id: "1y", label: "Aasta", days: 365, lead: "viimane aasta" },
  { id: "all", label: "Kõik", lead: "kõik salvestatud hinded" },
];

const gradeKey = (g) => [g.date, g.value, g.note, g.comment].join("|");

// Добавить оценки свежей синхронизации в архив (дубликаты по дате+оценке+описанию не повторяются).
function archiveGrades(grades) {
  if (!grades?.subjects?.length) return;
  if (!state.gradeArchive) {
    state.gradeArchive = {};
    state.gradeArchiveSince = Date.now();
  }
  const archive = state.gradeArchive;
  for (const subject of grades.subjects) {
    const list = archive[subject.name] || (archive[subject.name] = []);
    const byKey = new Map(list.map((g) => [gradeKey(g), g]));
    for (const g of subject.grades) {
      const old = byKey.get(gradeKey(g));
      if (old) Object.assign(old, g); // например, оценку заменили — обновится «asendatud»
      else list.push({ ...g });
    }
    list.sort((a, b) => a.date.localeCompare(b.date));
  }
}

// Оценки, сохранённые, пока Stuudium писал «95%», а Kooly это не понимал: исправить и убрать повторы.
function fixGradeValues() {
  const fix = (list) => {
    const seen = new Set();
    return list.filter((g) => {
      const value = gradeValue(g.value);
      if (value !== g.value) Object.assign(g, { value, numeric: gradeNumeric(value) });
      const key = gradeKey(g);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  for (const s of state.grades?.subjects || []) s.grades = fix(s.grades);
  for (const name of Object.keys(state.gradeArchive || {})) state.gradeArchive[name] = fix(state.gradeArchive[name]);
}

function progressRange() {
  return PROGRESS_RANGES.find((r) => r.id === state.progressRange) || PROGRESS_RANGES[0];
}

// Данные для экрана с учётом выбранного периода — в том же виде, что state.grades.
function progressData() {
  fixGradeValues();
  const data = state.grades;
  const range = progressRange();
  if (!data || range.id === "period") return data;
  if (!state.gradeArchive) archiveGrades(data); // первый запуск после обновления: архив из текущих оценок
  const cutoff = range.days ? dateKey(addDays(new Date(), -range.days)) : "";
  const finals = new Map((data.subjects || []).map((s) => [s.name, s.final]));
  const subjects = Object.entries(state.gradeArchive || {})
    .map(([name, grades]) => ({ name, final: finals.get(name) || "", grades: grades.filter((g) => g.date >= cutoff) }))
    .filter((s) => s.grades.length || finals.has(s.name));
  return { ...data, period: range.lead[0].toUpperCase() + range.lead.slice(1), subjects };
}

function rangeSwitchHtml() {
  const current = progressRange().id;
  return `<div class="segmented range-switch">${PROGRESS_RANGES.map(
    (r) => `<button data-action="progress-range" data-range="${r.id}" class="${r.id === current ? "active" : ""}">${r.label}</button>`
  ).join("")}</div>`;
}

const fmt1 = (x) => x.toFixed(1).replace(".", ",");
const fmtAvg = (x) => (Math.round(x * 10) / 10 === Math.round(x) ? String(Math.round(x)) : fmt1(x));

// Перевод процентов в 5-балльную шкалу (gümnaasiumi riiklik õppekava).
function grade5(p) {
  if (p >= 90) return 5;
  if (p >= 75) return 4;
  if (p >= 50) return 3;
  if (p >= 20) return 2;
  return 1;
}

const BANDS = [
  { label: "5", range: "90–100", min: 90 },
  { label: "4", range: "75–89", min: 75 },
  { label: "3", range: "50–74", min: 50 },
  { label: "2", range: "20–49", min: 20 },
  { label: "1", range: "0–19", min: 0 },
];

function splitName(name) {
  const m = name.match(/^(.*?)\s*\((.+)\)\s*$/);
  return m ? { main: m[1], sub: m[2] } : { main: name, sub: "" };
}

const numericOf = (subject) => subject.grades.filter((g) => g.active && g.numeric !== null);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function subjectStats(subject) {
  const nums = numericOf(subject);
  return {
    avg: nums.length ? mean(nums.map((g) => g.numeric)) : null,
    count: nums.length,
    ar: subject.grades.filter((g) => g.active && g.value === "AR").length,
    nums,
  };
}

// Накопительный средний после каждого дня с оценками — для трендов.
function cumulativeAverage(grades) {
  const byDate = [...grades].sort((a, b) => a.date.localeCompare(b.date));
  const points = [];
  let sum = 0;
  byDate.forEach((g, i) => {
    sum += g.numeric;
    const point = { date: g.date, value: sum / (i + 1) };
    if (points.length && points[points.length - 1].date === g.date) points[points.length - 1] = point;
    else points.push(point);
  });
  return points;
}

// Комментарий учителя часто дублирует описание оценки — такие не показываем.
const normText = (t) => (t || "").toLowerCase().replace(/\s+/g, " ").trim();
const sameText = (a, b) => normText(a) === normText(b) || normText(b).startsWith(normText(a)) || normText(a).startsWith(normText(b));

function shortDate(key) {
  const d = fromKey(key);
  return `${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

/* ---------- Графики (inline SVG, одна серия — без легенды) ---------- */

function sparklineSvg(values, w = 88, h = 30) {
  if (values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [3 + (i / (values.length - 1)) * (w - 6), h - 4 - ((v - min) / span) * (h - 8)]);
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    <polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" ")}" />
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" />
  </svg>`;
}

function gradeTip(g) {
  return [shortDate(g.date), g.value + (g.numeric !== null ? " %" : ""), g.note].filter(Boolean).join(" · ");
}

// Линия оценок по датам: ось 0/50/100, линия среднего, точки с подсказками.
function subjectChartSvg(nums, avg) {
  const W = 340, H = 180, L = 30, R = 14, T = 14, B = 26;
  const dates = nums.map((g) => +fromKey(g.date));
  const d0 = Math.min(...dates), d1 = Math.max(...dates);
  const yMin = Math.min(50, Math.floor((Math.min(...nums.map((g) => g.numeric)) - 10) / 10) * 10);
  const x = (t) => (d1 === d0 ? (L + W - R) / 2 : L + ((t - d0) / (d1 - d0)) * (W - L - R));
  const y = (v) => T + (1 - (v - yMin) / (100 - yMin)) * (H - T - B);
  const ticks = [yMin, Math.round((yMin + 100) / 2 / 5) * 5, 100];
  const pts = nums.map((g) => [x(+fromKey(g.date)), y(g.numeric), g]);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = pts.length > 1 ? `${path} L${pts[pts.length - 1][0].toFixed(1)},${(H - B).toFixed(1)} L${pts[0][0].toFixed(1)},${(H - B).toFixed(1)} Z` : "";
  const last = pts[pts.length - 1];
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Hinded aja jooksul, keskmine ${fmtAvg(avg)} %">
    ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" /><text class="tick" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join("")}
    <line class="avg-line" x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}" />
    ${area ? `<path class="area" d="${area}" />` : ""}
    ${pts.length > 1 ? `<path class="line" d="${path}" />` : ""}
    ${pts.map((p) => `<circle class="dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="5" data-tip="${esc(gradeTip(p[2]))}"><title>${esc(gradeTip(p[2]))}</title></circle>`).join("")}
    <text class="end-label" x="${Math.min(last[0], W - R - 4)}" y="${last[1] - 10}" text-anchor="middle">${last[2].numeric}</text>
    <text class="tick" x="${L}" y="${H - 6}">${shortDate(nums[0].date)}</text>
    ${nums.length > 1 ? `<text class="tick" x="${W - R}" y="${H - 6}" text-anchor="end">${shortDate(nums[nums.length - 1].date)}</text>` : ""}
  </svg>`;
}

function distributionHtml(all, arCount) {
  const counts = BANDS.map((b, i) => all.filter((v) => v >= b.min && (i === 0 || v < BANDS[i - 1].min)).length);
  const rows = BANDS.map((b, i) => ({ label: `„${b.label}“`, sub: `${b.range} %`, n: counts[i] }));
  if (arCount) rows.push({ label: "AR", sub: "arvestatud", n: arCount });
  const max = Math.max(...rows.map((r) => r.n), 1);
  return `<div class="dist">${rows
    .map(
      (r) => `<div class="dist-row" data-tip="${esc(`${r.label} (${r.sub}): ${r.n}`)}">
        <span class="dist-label"><b>${r.label}</b><small>${r.sub}</small></span>
        <span class="dist-track">${r.n ? `<span class="dist-bar" style="width:${Math.max(4, (r.n / max) * 100)}%"></span>` : ""}<span class="dist-n">${r.n}</span></span>
      </div>`
    )
    .join("")}</div>`;
}

/* ---------- Экраны ---------- */

function renderProgress() {
  const data = progressData();
  if (!data || !data.subjects?.length) {
    view.innerHTML = `
      <h1 class="page-title">Edenemine</h1>
      <section class="card">
        <p class="empty">Hinded tulevad Stuudiumist. <button class="link" data-action="open-settings" data-page="stuudium">Ühenda Stuudium</button></p>
      </section>`;
    return;
  }
  if (progressSubject) return renderProgressSubject(data.subjects.find((s) => s.name === progressSubject));
  const range = progressRange();

  const stats = data.subjects.map((s) => ({ s, ...subjectStats(s) }));
  const all = stats.flatMap((x) => x.nums);
  const values = all.map((g) => g.numeric);
  const arCount = stats.reduce((a, x) => a + x.ar, 0);
  const graded = stats.filter((x) => x.avg !== null).sort((a, b) => b.avg - a.avg);
  const ungraded = stats.filter((x) => x.avg === null);

  let hero = `<section class="hero"><div class="hero-label">${esc(data.period || "Praegune periood")}</div><div class="hero-title">${range.id === "period" ? "Numbrilisi hindeid veel pole" : "Sel ajal numbrilisi hindeid pole"}</div></section>`;
  if (values.length) {
    const avg = mean(values);
    const trend = cumulativeAverage(all);
    const cutoff = dateKey(addDays(new Date(), -14));
    const before = trend.filter((p) => p.date <= cutoff).pop();
    const delta = before ? avg - before.value : null;
    hero = `<section class="hero progress-hero">
      <div class="hero-label">${esc(data.period || "Praegune periood")}</div>
      <div class="big-avg">${fmtAvg(avg)}<span>%</span></div>
      <div class="hero-sub">kõigi hinnete keskmine · ≈ „${grade5(avg)}“</div>
      ${delta !== null && Math.abs(delta) >= 0.05 ? `<div class="delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "▲" : "▼"} ${fmt1(Math.abs(delta))} p 2 nädalaga</div>` : ""}
      ${trend.length > 1 ? `<div class="hero-spark">${sparklineSvg(trend.map((p) => p.value), 240, 44)}</div>` : ""}
    </section>`;
  }

  const tiles = [
    `<div class="stat"><small>Hindeid</small><b>${values.length}</b><span>${arCount ? `+ ${arCount} × AR` : "numbrilist"}</span></div>`,
  ];
  if (graded.length) tiles.push(`<div class="stat"><small>Parim aine</small><b>${fmtAvg(graded[0].avg)} %</b><span>${esc(splitName(graded[0].s.name).main)}</span></div>`);
  if (graded.length > 1 && graded[graded.length - 1].avg < graded[0].avg)
    tiles.push(`<div class="stat"><small>Tähelepanu</small><b>${fmtAvg(graded[graded.length - 1].avg)} %</b><span>${esc(splitName(graded[graded.length - 1].s.name).main)}</span></div>`);

  view.innerHTML = `
    <h1 class="page-title">Edenemine</h1>
    ${rangeSwitchHtml()}
    ${hero}
    <div class="stats">${tiles.join("")}</div>
    <div class="section-title">Ained</div>
    <ul class="subject-list">${graded
      .map(({ s, avg, count, nums }) => {
        const n = splitName(s.name);
        return `<li><button class="subject-card" data-action="open-subject" data-name="${esc(s.name)}">
          <span class="grow"><b>${esc(n.main)}</b><small>${plural(count, "hinne", "hinnet")}${n.sub ? ` · ${esc(n.sub)}` : ""}</small>
            <span class="grade-chips">${nums.slice(-5).map((g) => `<span class="gchip ${g.numeric < 50 ? "low" : ""}">${g.numeric}</span>`).join("")}</span></span>
          <span class="subject-side"><span class="subject-avg">${fmtAvg(avg)}<small>%</small></span>${sparklineSvg(cumulativeAverage(nums).map((p) => p.value))}</span>
        </button></li>`;
      })
      .join("")}</ul>
    ${ungraded.length ? `<p class="page-lead">Hindeid veel pole: ${ungraded.map((x) => esc(splitName(x.s.name).main)).join(", ")}</p>` : ""}
    ${values.length || arCount ? `<section class="card chart"><h2>Hinnete jaotus</h2>${distributionHtml(values, arCount)}<div class="chart-tip" aria-live="polite"></div></section>` : ""}
    ${data.courses?.length ? `<section class="card"><h2>Läbitud valikkursused</h2><ul class="course-list">${data.courses.map((c) => `<li><span>${esc(c.name)}</span><b>${esc(c.final)}</b></li>`).join("")}</ul></section>` : ""}
    <p class="page-lead">Uuendatud ${humanDay(new Date(data.updatedAt))} kell ${hhmm(new Date(data.updatedAt))} · „AR“ — arvestatud, keskmisesse ei lähe.</p>
    ${range.id !== "period" ? `<p class="page-lead">Stuudium näitab ainult praegust perioodi, seega Kooly kogub hindeid ise${state.gradeArchiveSince ? ` alates ${humanDay(new Date(state.gradeArchiveSince))}` : ""} — ajalugu kasvab iga sünkroonimisega.</p>` : ""}`;
}

function renderProgressSubject(subject) {
  if (!subject) {
    progressSubject = null;
    return renderProgress();
  }
  const { avg, nums, ar } = subjectStats(subject);
  const n = splitName(subject.name);
  const list = [...subject.grades].reverse();

  view.innerHTML = `
    <div class="page-head">
      <button class="back" data-action="close-subject">${ICONS.chevronLeft}<span>Edenemine</span></button>
      <h1 class="page-title">${esc(n.main)}</h1>
      ${n.sub ? `<p class="page-lead">${esc(n.sub)}</p>` : ""}
    </div>
    ${rangeSwitchHtml()}
    <div class="stats">
      <div class="stat"><small>Keskmine</small><b>${avg !== null ? `${fmtAvg(avg)} %` : "—"}</b><span>${avg !== null ? `≈ „${grade5(avg)}“` : "numbrilisi pole"}</span></div>
      <div class="stat"><small>Hindeid</small><b>${nums.length}</b><span>${ar ? `+ ${ar} × AR` : "numbrilist"}</span></div>
      ${subject.final ? `<div class="stat"><small>Kokkuvõttev</small><b>${esc(subject.final)}</b><span>kooliaste</span></div>` : ""}
    </div>
    ${nums.length ? `<section class="card chart"><h2>Hinded aja jooksul</h2>${subjectChartSvg(nums, avg)}<div class="chart-tip" aria-live="polite">Puuduta punkti, et näha hinnet</div></section>` : ""}
    <section class="card">
      <h2>Kõik hinded</h2>
      ${
        list.length
          ? `<ul class="grade-list">${list
              .map(
                (g) => `<li class="${g.active ? "" : "inactive"}">
                  <span class="gvalue ${g.numeric !== null && g.numeric < 50 ? "low" : ""}">${esc(g.value)}</span>
                  <span class="grow">
                    <b>${esc(g.note || (g.value === "AR" ? "Arvestatud" : "Hinne"))}</b>
                    <small>${shortDate(g.date)}${g.active ? "" : " · asendatud"}</small>
                    ${g.comment && !sameText(g.comment, g.note) ? `<span class="gcomment">${esc(g.comment)}</span>` : ""}
                    ${g.topic ? `<span class="gtopic">${esc(g.topic)}</span>` : ""}
                  </span>
                </li>`
              )
              .join("")}</ul>`
          : `<p class="empty">Selles perioodis hindeid veel pole</p>`
      }
    </section>`;
}

// Подсказка графика: наведение (мышь) или касание (телефон) по точке/строке.
function showChartTip(target) {
  const tip = target.closest(".chart")?.querySelector(".chart-tip");
  if (!tip) return;
  tip.textContent = target.dataset.tip;
  target.closest(".chart").querySelectorAll(".is-active").forEach((el) => el.classList.remove("is-active"));
  target.classList.add("is-active");
}

document.addEventListener("mouseover", (e) => {
  const t = e.target.closest?.("[data-tip]");
  if (t) showChartTip(t);
});
