"use strict";

/* =========================================================
   Kalender — месяц как в Google Календаре: уроки, задания, контрольные и события Google.
   + экспорт в .ics (любой календарь) и двусторонняя синхронизация с одним календарём Google.

   Google: вход через Google Identity Services прямо в браузере (без сервера), Calendar API по токену.
   Задания Kooly → события Google (extendedProperties.private.koolyTask = id задания).
   Изменили событие в Google (название/дату) → меняется задание в Kooly. Удалили в Google → больше не создаём.
   Свои события Google показываются в календаре Kooly.
   state.gcal = { clientId, calendarId, calendarName, push, pull, lastSync, events, deletes, error }
   ========================================================= */

const GCAL_SCOPES = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.app.created";
const GCAL_API = "https://www.googleapis.com/calendar/v3";
// Client ID приложения Kooly в Google Cloud (не секрет). Если задан — в настройках только кнопка «Logi sisse Google'iga».
const KOOLY_GOOGLE_CLIENT_ID = "810943360481-inmj85vf6s72qvqk35u8tqqj925s9k71.apps.googleusercontent.com";
const gcalClientId = () => KOOLY_GOOGLE_CLIENT_ID || state.gcal?.clientId || "";

const GCAL_PAST_DAYS = 30;
const GCAL_FUTURE_DAYS = 120;

let calMonth = null; // первый день показываемого месяца
let calSelected = null; // выбранный день (YYYY-MM-DD)
let calSlideFrom = 0; // откуда въезжает новый месяц: 1 — справа (следующий), -1 — слева (предыдущий)
let calSwipedAt = 0; // время последнего свайпа — чтобы после него не срабатывало нажатие на день
let gcalToken = null;
let gcalTokenExp = 0;
let gcalClient = null;
let gcalPending = null;
let gcalBusy = false;
let gcalCalendars = null; // список календарей для выбора

const isTest = (t) => /kontroll|test|\bkt\b|eksam|arvestus/i.test(`${t.kind || ""} ${t.title || t.text || ""}`);

/* ---------- Что происходит в конкретный день ---------- */

function dayTasks(key) {
  return sortByDeadline(visibleTasks().filter((t) => t.due === key));
}

function dayGoogleEvents(key) {
  if (!state.gcal?.pull) return [];
  return (state.gcal.events || []).filter((e) => e.startDate <= key && key < e.endDate);
}

function daySchoolEvents(key) {
  return (state.stuCal?.events || []).filter((e) => e.startDate <= key && key < e.endDate);
}

// Все события дня: школьные (Stuudium) и Google — по времени, «весь день» сверху.
function dayEvents(key) {
  const all = [...daySchoolEvents(key).map((e) => ({ ...e, source: "stuudium" })), ...dayGoogleEvents(key).map((e) => ({ ...e, source: "google" }))];
  return all.sort((a, b) => (a.allDay === b.allDay ? String(a.start).localeCompare(String(b.start)) : a.allDay ? -1 : 1));
}

function dayDots(key) {
  const tasks = dayTasks(key).filter((t) => !t.done);
  const dots = [];
  if (tasks.some(isTest)) dots.push("test");
  if (tasks.some((t) => !isTest(t))) dots.push("task");
  if (daySchoolEvents(key).length) dots.push("school");
  if (dayGoogleEvents(key).length) dots.push("google");
  return dots;
}

/* ---------- Вкладка «Kalender» ---------- */

function renderCalendar() {
  const now = new Date();
  if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  if (!calSelected) calSelected = dateKey(now);
  const todayKey = dateKey(now);

  // Сетка месяца с понедельника, 6 недель.
  const offset = (calMonth.getDay() + 6) % 7;
  const gridStart = addDays(calMonth, -offset);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const key = dateKey(d);
    const inMonth = d.getMonth() === calMonth.getMonth();
    if (i >= 35 && !inMonth && d.getDay() === 1) break; // лишняя последняя неделя
    cells.push(`<button class="cal-day ${inMonth ? "" : "out"} ${key === todayKey ? "today" : ""} ${key === calSelected ? "selected" : ""} ${lessonsFor(d).length ? "school" : ""}"
        data-action="cal-pick" data-day="${key}" aria-label="${d.getDate()}. ${MONTHS[d.getMonth()]}">
      <span class="cal-num">${d.getDate()}</span>
      <span class="cal-dots">${dayDots(key).map((k) => `<i class="dot dot-${k}"></i>`).join("")}</span>
    </button>`);
  }

  const sel = fromKey(calSelected);
  const lessons = lessonsFor(sel);
  const tasks = dayTasks(calSelected);
  const events = dayEvents(calSelected);
  const upcomingTests = sortByDeadline(visibleTasks().filter((t) => !t.done && t.due && t.due >= todayKey && isTest(t))).slice(0, 5);
  const g = state.gcal;

  view.innerHTML = `
    <div class="tasks-head">
      <h1 class="page-title">Kalender</h1>
      ${
        g?.calendarId
          ? `<button class="sync-pill ${gcalBusy ? "busy" : ""}" data-action="gcal-sync">${ICONS.refresh}<span>${gcalBusy ? "Sünkroonin…" : `Google${g.lastSync ? ` · ${hhmm(new Date(g.lastSync))}` : ""}`}</span></button>`
          : `<button class="sync-pill" data-action="open-settings" data-page="gcal">${ICONS.calendar}<span>Google Kalender</span></button>`
      }
    </div>
    <section class="card cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="cal-month" data-step="-1" aria-label="Eelmine kuu">${ICONS.chevronLeft}</button>
        <b>${capitalize(MONTHS[calMonth.getMonth()])} ${calMonth.getFullYear()}</b>
        <button class="icon-btn" data-action="cal-month" data-step="1" aria-label="Järgmine kuu">${ICONS.chevronRight}</button>
      </div>
      <div class="cal-grid">
        ${["E", "T", "K", "N", "R", "L", "P"].map((d) => `<span class="cal-wd">${d}</span>`).join("")}
        ${cells.join("")}
      </div>
      <div class="cal-legend"><span><i class="dot dot-test"></i>kontrolltöö</span><span><i class="dot dot-task"></i>ülesanne</span>${state.stuCal?.events?.length ? `<span><i class="dot dot-school"></i>kooli sündmus</span>` : ""}${g?.calendarId && g?.pull ? `<span><i class="dot dot-google"></i>Google</span>` : ""}
        ${calSelected !== todayKey ? `<button class="link" data-action="cal-today">Täna</button>` : ""}</div>
    </section>

    <div class="day-title">${["täna", "homme", "ülehomme", "eile"].includes(humanDay(sel, now)) ? `${capitalize(humanDay(sel, now))} · ` : ""}${capitalize(DAYS[sel.getDay()])}, ${sel.getDate()}. ${MONTHS[sel.getMonth()]}</div>
    ${events.length ? `<ul class="gcal-list">${events.map(gcalEventHtml).join("")}</ul>` : ""}
    ${tasks.length ? taskListHtml(tasks, now) : ""}
    ${lessons.length ? `<details class="card cal-lessons"><summary><b>Tunnid</b> <small>${plural(lessons.length, "tund", "tundi")} · ${hhmm(lessons[0].start)}–${hhmm(lessons[lessons.length - 1].end)}</small></summary>${lessonListHtml(lessons, dateKey(now) === calSelected ? now : null)}</details>` : ""}
    ${!events.length && !tasks.length && !lessons.length ? `<p class="empty">Sellel päeval pole midagi</p>` : ""}

    ${upcomingTests.length ? `<div class="section-title">Eelseisvad kontrolltööd</div>${taskListHtml(upcomingTests, now)}` : ""}
    <div class="actions" style="justify-content:center">
      <button class="btn small" data-action="ics-export">Lisa kõik kalendrisse (.ics)</button>
    </div>`;
  bindCalendarSwipe();
}

/* ---------- Свайп месяцев влево-вправо, как в Google Календаре ---------- */

function changeMonth(step) {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + step, 1);
  calSlideFrom = step;
  render();
}

function bindCalendarSwipe() {
  const card = view.querySelector(".cal");
  const grid = card?.querySelector(".cal-grid");
  const title = card?.querySelector(".cal-head b");
  if (!grid) return;
  const moving = [grid, title];
  const setX = (x, opacity, transition) =>
    moving.forEach((el) => {
      el.style.transition = transition;
      el.style.transform = x ? `translateX(${x})` : "";
      el.style.opacity = opacity;
    });

  // Новый месяц въезжает с той стороны, куда листали.
  if (calSlideFrom) {
    const from = calSlideFrom;
    calSlideFrom = 0;
    setX(`${from * 40}%`, "0", "none");
    requestAnimationFrame(() => requestAnimationFrame(() => setX("", "", "transform 0.22s ease-out, opacity 0.22s ease-out")));
  }

  let x0 = 0, y0 = 0, dx = 0, width = 1, active = false, horizontal = null;
  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    dx = 0;
    width = card.clientWidth || 1;
    active = true;
    horizontal = null;
  }, { passive: true });

  card.addEventListener("touchmove", (e) => {
    if (!active) return;
    dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) horizontal = Math.abs(dx) > Math.abs(dy);
    if (!horizontal) return;
    e.preventDefault(); // листаем месяц, а не страницу
    setX(`${dx}px`, String(1 - Math.min(Math.abs(dx) / width, 0.6)), "none"); // месяц едет за пальцем
  }, { passive: false });

  const finish = () => {
    if (!active) return;
    active = false;
    if (horizontal && Math.abs(dx) > Math.min(60, width * 0.18)) {
      const step = dx < 0 ? 1 : -1; // влево — следующий месяц, вправо — предыдущий
      calSwipedAt = Date.now();
      setX(`${-step * 60}%`, "0", "transform 0.16s ease-in, opacity 0.16s ease-in");
      setTimeout(() => changeMonth(step), 150);
    } else if (horizontal) {
      setX("", "", "transform 0.2s ease-out, opacity 0.2s ease-out"); // не дотянули — месяц возвращается
    }
  };
  card.addEventListener("touchend", finish);
  card.addEventListener("touchcancel", finish);
}

function gcalEventHtml(e) {
  const time = e.allDay ? "Terve päev" : `${hhmm(new Date(e.start))}–${hhmm(new Date(e.end))}`;
  const from = e.source === "stuudium" ? " · Stuudium" : e.source === "google" ? " · Google" : "";
  return `<li class="gcal-event ${e.source || ""}"><span class="gcal-bar"></span><span class="grow"><b>${esc(e.summary || "(pealkirjata)")}</b><small>${time}${e.location ? ` · ${esc(e.location)}` : ""}${from}</small>${
    e.description ? `<span class="gcal-desc">${esc(e.description)}</span>` : ""
  }</span></li>`;
}

/* ---------- Stuudiumi kalender (Suhtlus): iCal-лента событий ----------
   В Stuudium: Suhtlus → Kalender → «Kalendri voog» — личная ссылка-лента (iCal) со всеми событиями своих групп.
   Kooly читает её через посредника (сервер на Mac или облачный Worker) и обновляет сама. */

const STUCAL_REFRESH_MS = 3 * 60 * 60 * 1000;
let stuCalBusy = false;

function icsParseDate(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const allDay = params.some((p) => p.toUpperCase() === "VALUE=DATE") || !m[4];
  if (allDay) return { allDay: true, iso: `${m[1]}-${m[2]}-${m[3]}` };
  const [, y, mo, d, h, mi, s, z] = m.map((x, i) => (i && i < 7 ? Number(x) : x));
  const date = z ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s); // TZID → время Эстонии (как у устройства)
  return { allDay: false, iso: date.toISOString() };
}

function parseIcs(text) {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const unescape = (v) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  const events = [];
  let ev = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT") {
      if (ev?.start && ev.status !== "CANCELLED") events.push(ev);
      ev = null;
    } else if (ev) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [rawName, ...params] = line.slice(0, colon).split(";");
      const name = rawName.toUpperCase();
      const value = line.slice(colon + 1);
      if (name === "SUMMARY") ev.summary = unescape(value);
      else if (name === "DESCRIPTION") ev.description = unescape(value).trim();
      else if (name === "LOCATION") ev.location = unescape(value);
      else if (name === "UID") ev.id = value;
      else if (name === "STATUS") ev.status = value.toUpperCase();
      else if (name === "DTSTART" || name === "DTEND") {
        const d = icsParseDate(value, params);
        if (!d) continue;
        if (name === "DTSTART") {
          ev.start = d.iso;
          ev.allDay = d.allDay;
        } else ev.end = d.iso;
      }
    }
  }
  // Приводим к виду событий календаря Kooly (как у Google).
  return events.map((e) => {
    const startDate = e.allDay ? e.start : dateKey(new Date(e.start));
    const end = e.end || (e.allDay ? dateKey(addDays(fromKey(e.start), 1)) : e.start);
    const endDate = e.allDay ? end : dateKey(addDays(new Date(end), 1));
    return { id: e.id || shortHash(`${e.start}|${e.summary}`), summary: e.summary || "", description: e.description || "", location: e.location || "", allDay: e.allDay, start: e.start, end, startDate, endDate };
  });
}

async function stuCalSync({ quiet = false } = {}) {
  const c = state.stuCal;
  if (!c?.url || stuCalBusy) return;
  stuCalBusy = true;
  try {
    const page = await fetchPage(c.url.replace(/^webcal:\/\//i, "https://"));
    if (!/BEGIN:VCALENDAR/.test(page.text)) throw new Error("not-ics");
    const from = dateKey(addDays(new Date(), -60)), to = dateKey(addDays(new Date(), 240));
    c.events = parseIcs(page.text).filter((e) => e.endDate >= from && e.startDate <= to);
    c.lastSync = Date.now();
    c.error = null;
    if (!quiet) toast(`Stuudiumi kalender: ${plural(c.events.length, "sündmus", "sündmust")}`);
  } catch (e) {
    c.error = e.message;
    if (!quiet) toast(stuCalErrorText(e.message));
  } finally {
    stuCalBusy = false;
    save();
    if (["calendar", "tomorrow", "now"].includes(currentTab) || onSettingsPage("stuudium")) render();
  }
}

function stuCalAutoSync() {
  const c = state.stuCal;
  if (c?.url && hasProxy() && Date.now() - (c.lastSync || 0) > STUCAL_REFRESH_MS) stuCalSync({ quiet: true });
}

function stuCalErrorText(code) {
  return (
    {
      "not-ics": "See link ei ole kalendri voog. Kopeeri Stuudiumist „Kalendri voo“ aadress.",
      "not-allowed": "Pilveühendus ei luba seda aadressi (Workeri ALLOWED_SITES).",
      "no-proxy": "Kalendri laadimiseks on vaja ühendust (Seaded → Ühendus).",
    }[code] || "Stuudiumi kalendrit ei õnnestunud laadida. Proovi uuesti."
  );
}

function stuCalCardHtml() {
  const c = state.stuCal || {};
  const school = state.stuudium?.school || STUUDIUM_DEFAULT_SCHOOL;
  return `<section class="card">
    <h2>Stuudiumi kalender ${c.events ? `<span class="soon-badge ok">${plural(c.events.length, "sündmus", "sündmust")}</span>` : ""}</h2>
    ${
      c.url
        ? `<p class="muted small" style="margin:0 0 10px">Kooli sündmused (Suhtlus → Kalender) uuenevad ise iga 3 tunni järel.${c.lastSync ? ` Viimati ${humanDay(new Date(c.lastSync))} kell ${hhmm(new Date(c.lastSync))}.` : ""}</p>`
        : `<ol class="steps">
            <li>Ava <a href="https://${esc(school)}.ope.ee/suhtlus/" target="_blank" rel="noopener">Stuudium → Suhtlus</a> → <b>Kalender</b>.</li>
            <li>Keri alla ja vajuta <b>„Sündmused kalendrirakendusse“</b>.</li>
            <li>„Kõik sündmused“ all <b>hoia sõrme</b> lingil „Kopeeri selle lingi aadress“ ja vali <b>„Kopeeri link“</b> (ära lihtsalt vajuta — siis avaneb kalender).</li>
            <li>Tule tagasi ja vajuta <b>„Kleebi“</b>.</li>
          </ol>`
    }
    <form class="composer" id="stucal-form" autocomplete="off">
      <input class="input" id="stucal-url" value="${esc(c.url || "")}" placeholder="Kalendri voo aadress (https://… või webcal://…)" inputmode="url" />
      <button class="btn primary" type="submit">${stuCalBusy ? "…" : c.url ? "Uuenda" : "Lisa"}</button>
    </form>
    ${c.url ? "" : `<div class="actions"><button class="btn small" data-action="stucal-paste">Kleebi lõikelaualt</button></div>`}
    ${c.error ? `<p class="error">${esc(stuCalErrorText(c.error))}</p>` : ""}
  </section>`;
}

// Вставка адреса ленты из буфера обмена (на iPhone спросит «Вставить?»).
async function stuCalPaste() {
  let url = "";
  try {
    url = (await navigator.clipboard.readText()).trim();
  } catch {
    return toast("Kleebi aadress väljale käsitsi (hoia sõrme väljal → Kleebi).");
  }
  if (!/^(https?|webcal):\/\//i.test(url)) return toast("Lõikelaual pole linki. Kopeeri Stuudiumist „Kõik sündmused“ lingi aadress.");
  state.stuCal = { ...(state.stuCal || {}), url, error: null };
  save();
  stuCalSync();
}

function bindStuCal() {
  document.getElementById("stucal-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const url = document.getElementById("stucal-url").value.trim();
    if (!url) {
      state.stuCal = null;
      save();
      return render();
    }
    if (!/^(https?|webcal):\/\//i.test(url)) return toast("Kleebi täielik aadress (algab https:// või webcal://)");
    state.stuCal = { ...(state.stuCal || {}), url, error: null };
    save();
    stuCalSync();
  });
}

// «Homme koolis» / «Täna koolis» — школьные события дня (Homme, Praegu).
function schoolEventsCardHtml(day, title) {
  const events = daySchoolEvents(dateKey(day));
  if (!events.length) return "";
  return `<section class="card"><h2>${title}</h2><ul class="gcal-list">${events.map((e) => gcalEventHtml({ ...e, source: "" })).join("")}</ul></section>`;
}

function handleCalendarAction(action, btn) {
  if (action === "cal-pick") {
    if (Date.now() - calSwipedAt < 400) return; // это был свайп, а не нажатие на день
    calSelected = btn.dataset.day;
    const d = fromKey(calSelected);
    calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  } else if (action === "cal-month") {
    return changeMonth(Number(btn.dataset.step));
  } else if (action === "cal-today") {
    const now = new Date();
    calSelected = dateKey(now);
    calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (action === "ics-export") {
    return exportIcs();
  } else if (action === "gcal-sync") {
    return gcalSync({ interactive: true });
  } else if (action === "gcal-connect") {
    return gcalConnect();
  } else if (action === "gcal-create") {
    return gcalCreateCalendar();
  } else if (action === "gcal-disconnect") {
    return gcalDisconnect();
  } else if (action === "stucal-paste") {
    return stuCalPaste();
  }
  render();
}

/* ---------- Событие календаря из задания ---------- */

// Постоянный ключ задания для Google: у домашки из Stuudium он одинаковый на всех устройствах.
function taskKey(t) {
  return t.extId || `kooly:${t.id}`;
}

function taskSubjectName(t) {
  return (t.subjectId && subjectById(t.subjectId)?.name) || t.subjectName || "";
}

// Описание события: что сделать + описание + откуда.
function taskEvent(t) {
  const subject = taskSubjectName(t);
  const title = t.title || t.text;
  const summary = `${t.done ? "✓ " : ""}${isTest(t) ? "📝" : "📘"} ${subject ? `${subject}: ` : ""}${title}`;
  const dl = taskDeadline(t);
  const lesson = dl?.lesson;
  const description = [t.kind, descriptionText(t), ...(t.links || []).map((l) => l.href), t.source === "stuudium" ? "Stuudiumist · Kooly" : "Kooly"].filter(Boolean).join("\n");
  if (lesson) {
    return {
      summary,
      description,
      start: { dateTime: lesson.start.toISOString(), timeZone: "Europe/Tallinn" },
      end: { dateTime: lesson.end.toISOString(), timeZone: "Europe/Tallinn" },
      ...(lesson.room ? { location: `ruum ${lesson.room}` } : {}),
    };
  }
  return { summary, description, start: { date: t.due }, end: { date: dateKey(addDays(fromKey(t.due), 1)) } };
}

/* ---------- .ics: все задания одним файлом (Apple Календарь, Google, Outlook) ---------- */

function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
}

function exportIcs() {
  const todayKey = dateKey(addDays(new Date(), -1));
  const tasks = visibleTasks().filter((t) => !t.done && t.due && t.due >= todayKey);
  if (!tasks.length) return toast("Tulevasi ülesandeid pole");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kooly//ET", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Kooly"];
  for (const t of tasks) {
    const ev = taskEvent(t);
    lines.push("BEGIN:VEVENT", `UID:${t.id}@kooly`, `DTSTAMP:${icsDate(new Date())}`, `SUMMARY:${icsText(ev.summary)}`, `DESCRIPTION:${icsText(ev.description)}`);
    if (ev.start.dateTime) lines.push(`DTSTART:${icsDate(new Date(ev.start.dateTime))}`, `DTEND:${icsDate(new Date(ev.end.dateTime))}`);
    else lines.push(`DTSTART;VALUE=DATE:${ev.start.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${ev.end.date.replace(/-/g, "")}`);
    if (ev.location) lines.push(`LOCATION:${icsText(ev.location)}`);
    if (isTest(t)) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Kontrolltöö homme", "TRIGGER:-PT18H", "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kooly.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${plural(tasks.length, "sündmus", "sündmust")} — ava fail ja lisa kalendrisse`);
}

/* ---------- Google: вход ---------- */

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = () => reject(new Error("gis"));
    document.head.appendChild(s);
  });
}

// interactive — по нажатию кнопки (Google откроет окно входа). Без нажатия — только пока жив прежний токен.
async function gcalAccessToken(interactive) {
  if (gcalToken && Date.now() < gcalTokenExp) return gcalToken;
  if (!interactive) throw new Error("need-login");
  await loadGis();
  if (!gcalClient) {
    gcalClient = google.accounts.oauth2.initTokenClient({
      client_id: gcalClientId(),
      scope: GCAL_SCOPES,
      callback: (r) => {
        const p = gcalPending;
        gcalPending = null;
        if (r.error) return p?.reject(new Error(r.error));
        gcalToken = r.access_token;
        gcalTokenExp = Date.now() + (Number(r.expires_in) - 60) * 1000;
        p?.resolve(gcalToken);
      },
      error_callback: (e) => {
        const p = gcalPending;
        gcalPending = null;
        p?.reject(new Error(e?.type || "popup"));
      },
    });
  }
  return new Promise((resolve, reject) => {
    gcalPending = { resolve, reject };
    gcalClient.requestAccessToken({ prompt: state.gcal.granted ? "" : "consent" });
  });
}

async function gapi(path, { method = "GET", body, token } = {}) {
  const res = await fetch(path.startsWith("http") ? path : GCAL_API + path, {
    method,
    headers: { Authorization: `Bearer ${token || gcalToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    gcalToken = null;
    throw new Error("need-login");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `http-${res.status}`), { status: res.status });
  return data;
}

async function gcalConnect() {
  if (!state.gcal) state.gcal = { push: true, pull: true };
  const input = document.getElementById("gcal-client");
  if (input && !KOOLY_GOOGLE_CLIENT_ID) {
    const id = input.value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) return toast("See ei näe välja nagu Client ID (…apps.googleusercontent.com)");
    state.gcal = { ...(state.gcal || {}), clientId: id, push: state.gcal?.push ?? true, pull: state.gcal?.pull ?? true };
    gcalClient = null;
    save();
  }
  try {
    await gcalAccessToken(true);
    state.gcal.granted = true;
    const list = await gapi("/users/me/calendarList?minAccessRole=writer");
    gcalCalendars = (list.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: Boolean(c.primary) }));
    state.gcal.email = gcalCalendars.find((c) => c.primary)?.id || "";
    save();
    render();
    toast("Google'iga ühendatud — vali kalender");
  } catch (e) {
    console.warn("gcal", e);
    toast(gcalErrorText(e.message));
  }
}

async function gcalCreateCalendar() {
  try {
    await gcalAccessToken(true);
    const cal = await gapi("/calendars", { method: "POST", body: { summary: "Kooly", description: "Kooly: kodutööd ja kontrolltööd", timeZone: "Europe/Tallinn" } });
    state.gcal.calendarId = cal.id;
    state.gcal.calendarName = "Kooly";
    gcalCalendars = [...(gcalCalendars || []), { id: cal.id, name: "Kooly" }];
    save();
    await gcalSync({ interactive: true });
  } catch (e) {
    toast(gcalErrorText(e.message));
  }
}

function gcalDisconnect() {
  if (!confirm("Kas katkestada ühendus Google Kalendriga? Google'is olevad sündmused jäävad alles.")) return;
  try {
    if (gcalToken) google.accounts.oauth2.revoke(gcalToken, () => {});
  } catch {
    // токен всё равно забываем
  }
  gcalToken = null;
  gcalClient = null;
  gcalCalendars = null;
  const clientId = state.gcal?.clientId;
  state.gcal = clientId && !KOOLY_GOOGLE_CLIENT_ID ? { clientId, push: true, pull: true } : null;
  state.tasks.forEach((t) => delete t.gcal);
  save();
  render();
}

function gcalErrorText(code) {
  return (
    {
      "need-login": "Logi uuesti Google'isse — vajuta „Sünkrooni“.",
      popup: "Google'i aken suleti või blokeeriti. Proovi uuesti.",
      popup_closed: "Google'i aken suleti. Proovi uuesti.",
      popup_failed_to_open: "Brauser blokeeris Google'i akna. Luba hüpikaknad.",
      access_denied: "Google'i luba ei antud.",
      gis: "Google'i sisselogimist ei õnnestunud laadida. Kontrolli internetti.",
      idpiframe_initialization_failed: "Kontrolli Client ID seadeid (lubatud aadressid).",
    }[code] || `Google Kalender: ${code}`
  );
}

/* ---------- Google: двусторонняя синхронизация ---------- */

// Отпечаток того, что мы отправили в Google: если в Kooly задание поменялось — отпечаток другой.
function eventSig(ev) {
  return shortHash(JSON.stringify([ev.summary, ev.description, ev.start, ev.end, ev.location || ""]));
}

function cleanSummary(summary) {
  return summary.replace(/^✓\s*/, "").replace(/^(📝|📘)\s*/u, "");
}

function eventStartDate(ev) {
  return ev.start?.date || (ev.start?.dateTime ? dateKey(new Date(ev.start.dateTime)) : null);
}

async function gcalSync({ interactive = false, quiet = false } = {}) {
  const g = state.gcal;
  if (!g?.calendarId || gcalBusy) return;
  gcalBusy = true;
  if (currentTab === "calendar" || onSettingsPage("gcal")) render();
  let pushed = 0, pulled = 0;
  try {
    await gcalAccessToken(interactive);
    const cal = encodeURIComponent(g.calendarId);
    const now = new Date();
    const from = addDays(now, -GCAL_PAST_DAYS), to = addDays(now, GCAL_FUTURE_DAYS);

    // 1. Читаем события окна (с удалёнными — чтобы заметить удаление наших событий в Google).
    const events = [];
    let pageToken = "";
    do {
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", showDeleted: "true", maxResults: "250" });
      if (pageToken) q.set("pageToken", pageToken);
      const page = await gapi(`/calendars/${cal}/events?${q}`);
      events.push(...(page.items || []));
      pageToken = page.nextPageToken || "";
    } while (pageToken);

    // Наши события (созданные Kooly) и чужие. Наше событие узнаём по ключу задания, а не по пометке в Kooly:
    // так дублей не будет, даже если Kooly забыл связь (новый календарь, другое устройство, переустановка).
    const ours = [];
    const external = [];
    for (const ev of events) {
      const p = ev.extendedProperties?.private || {};
      if (p.koolyKey || p.koolyTask) ours.push(ev);
      else if (ev.status !== "cancelled") external.push(ev);
    }
    const eventKey = (ev) => ev.extendedProperties.private.koolyKey || `kooly:${ev.extendedProperties.private.koolyTask}`;
    const looksSame = (ev) => `${cleanSummary(ev.summary || "")}|${eventStartDate(ev)}`; // для старых дублей без ключа

    // 1б. Уборка уже созданных дублей: одинаковый ключ или одинаковые название и день — оставляем одно событие.
    const linkedIds = new Set(state.tasks.map((t) => t.gcal?.id).filter(Boolean));
    const keep = new Map();
    const duplicates = [];
    for (const ev of ours.filter((e) => e.status !== "cancelled")) {
      for (const k of [`key:${eventKey(ev)}`, `same:${looksSame(ev)}`]) {
        const kept = keep.get(k);
        if (!kept) {
          keep.set(k, ev);
        } else if (kept !== ev) {
          // Оставляем то, на которое уже ссылается задание Kooly; иначе — первое.
          const [stay, drop] = linkedIds.has(ev.id) && !linkedIds.has(kept.id) ? [ev, kept] : [kept, ev];
          keep.set(k, stay);
          if (!duplicates.includes(drop)) duplicates.push(drop);
        }
      }
    }
    for (const ev of duplicates) {
      try {
        await gapi(`/calendars/${cal}/events/${encodeURIComponent(ev.id)}`, { method: "DELETE" });
      } catch (e) {
        if (e.status !== 404 && e.status !== 410) throw e;
      }
      ev.status = "cancelled";
      ev.koolyDuplicate = true;
    }
    const alive = ours.filter((e) => !e.koolyDuplicate);
    const byKey = new Map(alive.map((ev) => [eventKey(ev), ev]));
    const byId = new Map(alive.map((ev) => [ev.id, ev]));
    const bySame = new Map(alive.filter((e) => e.status !== "cancelled").map((ev) => [looksSame(ev), ev]));

    // 2. Удалённые в Kooly задания — удаляем их события.
    for (const id of g.deletes || []) {
      try {
        await gapi(`/calendars/${cal}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch (e) {
        if (e.status !== 404 && e.status !== 410) throw e;
      }
    }
    g.deletes = [];

    // 3. Задания ↔ события.
    const fromKeyStr = dateKey(from), toKeyStr = dateKey(to);
    for (const t of state.tasks) {
      if (t.dismissed || !t.due || t.due < fromKeyStr || t.due > toKeyStr || t.gcal?.removed) continue;
      const key = taskKey(t);
      // Ищем уже существующее событие: по ключу, по сохранённой связи или по тому же названию в тот же день.
      let ev = byKey.get(key) || (t.gcal?.id && byId.get(t.gcal.id)) || bySame.get(looksSame({ summary: taskEvent(t).summary, start: taskEvent(t).start }));
      if (ev?.status === "cancelled") {
        if (ev.koolyDuplicate) ev = null;
        else {
          t.gcal = { ...(t.gcal || {}), id: ev.id, removed: true }; // удалили в Google — больше не создаём
          continue;
        }
      }
      if (ev && !t.gcal?.id) t.gcal = { id: ev.id, etag: ev.etag, sig: null }; // нашли своё событие — привязываем, не создаём новое
      if (ev && ev.etag !== t.gcal.etag) {
        // Изменили в Google → переносим в Kooly название и дату.
        const title = cleanSummary(ev.summary || "");
        const subject = taskSubjectName(t);
        t.title = subject && title.startsWith(`${subject}: `) ? title.slice(subject.length + 2) : title;
        t.text = t.title;
        const day = eventStartDate(ev);
        if (day) t.due = day;
        t.gcal = { id: ev.id, etag: ev.etag, sig: eventSig(taskEvent(t)) };
        pulled++;
        continue;
      }
      if (!g.push) continue;
      const body = { ...taskEvent(t), extendedProperties: { private: { koolyTask: t.id, koolyKey: key } } };
      const sig = eventSig(body);
      const hasKey = ev?.extendedProperties?.private?.koolyKey === key;
      if (ev && t.gcal?.sig === sig && hasKey) continue; // ничего не поменялось
      const saved = ev
        ? await gapi(`/calendars/${cal}/events/${encodeURIComponent(ev.id)}`, { method: "PATCH", body })
        : await gapi(`/calendars/${cal}/events`, { method: "POST", body });
      t.gcal = { id: saved.id, etag: saved.etag, sig };
      byKey.set(key, saved); // если то же задание встретится дважды — не создаём второе событие
      pushed++;
    }
    g.removedDuplicates = duplicates.length;

    // 4. Свои события Google — для календаря Kooly.
    g.events = external.map((ev) => {
      const allDay = Boolean(ev.start?.date);
      return {
        id: ev.id,
        summary: ev.summary || "",
        location: ev.location || "",
        allDay,
        start: allDay ? ev.start.date : ev.start?.dateTime,
        end: allDay ? ev.end.date : ev.end?.dateTime,
        startDate: eventStartDate(ev),
        endDate: allDay ? ev.end.date : dateKey(addDays(new Date(ev.end?.dateTime || ev.start?.dateTime), 1)),
      };
    });
    g.lastSync = Date.now();
    g.error = null;
    const cleaned = g.removedDuplicates || 0;
    if (!quiet || cleaned) toast(`Google Kalender sünkroonitud${pushed ? ` · saadetud ${pushed}` : ""}${pulled ? ` · muudetud ${pulled}` : ""}${cleaned ? ` · eemaldatud ${plural(cleaned, "korduv sündmus", "korduvat sündmust")}` : ""}`);
  } catch (e) {
    console.warn("gcal sync", e);
    g.error = e.message;
    if (!quiet || e.message !== "need-login") toast(gcalErrorText(e.message));
  } finally {
    gcalBusy = false;
    save();
    if (["calendar", "tasks", "now", "tomorrow"].includes(currentTab) || onSettingsPage("gcal")) render();
  }
}

// После изменений в заданиях — тихая синхронизация, если вход ещё действителен (токен живёт час).
let gcalAutoTimer = null;
function gcalAutoSync() {
  if (!state.gcal?.calendarId || !gcalToken || Date.now() > gcalTokenExp || gcalBusy) return;
  if (Date.now() - (state.gcal.lastSync || 0) < 10000) return; // только что синхронизировались
  clearTimeout(gcalAutoTimer);
  gcalAutoTimer = setTimeout(() => gcalSync({ quiet: true }), 2500);
}

function gcalForgetTask(t) {
  if (!t?.gcal?.id || !state.gcal) return;
  state.gcal.deletes = [...(state.gcal.deletes || []), t.gcal.id];
}

/* ---------- Страница настроек «Google Kalender» ---------- */

function gcalPageHtml() {
  const g = state.gcal || {};
  const origin = location.origin;
  const setup = `
    <details class="card setup" ${g.clientId ? "" : "open"}>
      <summary><b>Google'i seadistamine</b> <small>üks kord, ~5 minutit</small></summary>
      <ol class="steps">
        <li>Ava <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud Console</a> ja loo projekt <b>Kooly</b>.</li>
        <li>Lülita sisse <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener">Google Calendar API</a> (Enable).</li>
        <li><a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">Google Auth Platform</a> → Get started: rakenduse nimi <b>Kooly</b>, oma e-post, Audience: <b>External</b>. Seejärel <b>Audience → Test users</b> → lisa oma Gmail.</li>
        <li><a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener">Clients</a> → Create client → <b>Web application</b> → Authorized JavaScript origins: <code>${esc(origin)}</code> → Create.</li>
        <li>Kopeeri <b>Client ID</b> ja kleebi siia.</li>
      </ol>
      <form class="composer" onsubmit="event.preventDefault()">
        <input class="input" id="gcal-client" value="${esc(g.clientId || "")}" placeholder="….apps.googleusercontent.com" autocomplete="off" />
      </form>
    </details>`;

  const builtIn = Boolean(KOOLY_GOOGLE_CLIENT_ID);
  // Google не пускает вход внутри встроенных окон приложений — в приложении для iPhone это пока недоступно.
  if (hasNative && !g.granted) {
    return `<section class="card"><p class="muted small" style="margin:0">Google ei luba sisse logida rakenduse sees olevas aknas. Google Kalendri ühendamine tuleb rakendusse järgmises versioonis — seni kasuta Kooly Safari-versiooni (${esc(location.host)}).</p></section>`;
  }
  if (!g.granted) {
    return `${builtIn ? "" : setup}
      <section class="card">
        <p class="muted small" style="margin:0 0 12px">Kooly paneb kodutööd ja kontrolltööd sinu Google Kalendrisse ning näitab Google'i sündmusi Kooly kalendris. Muudatused liiguvad mõlemas suunas.</p>
        <button class="btn primary google-btn" data-action="gcal-connect">${builtIn ? "Logi sisse Google'iga" : "Ühenda Google Kalender"}</button>
      </section>`;
  }

  const options = (gcalCalendars || (g.calendarId ? [{ id: g.calendarId, name: g.calendarName }] : []))
    .map((c) => `<option value="${esc(c.id)}" ${c.id === g.calendarId ? "selected" : ""}>${esc(c.name)}${c.primary ? " (peamine)" : ""}</option>`)
    .join("");
  return `
    <section class="card">
      <h2>Google Kalender <span class="soon-badge ok">ühendatud</span></h2>
      ${g.email ? `<p class="muted small" style="margin:0 0 8px">${esc(g.email)}</p>` : ""}
      <label class="field-label" for="gcal-calendar">Kalender</label>
      ${
        options
          ? `<select class="input" id="gcal-calendar" data-field="gcal-calendar"><option value="">— vali kalender —</option>${options}</select>`
          : `<p class="muted small">Kalendrite nimekirja nägemiseks vajuta „Ühenda uuesti“.</p>`
      }
      <div class="actions">
        <button class="btn small" data-action="gcal-create">Loo eraldi kalender „Kooly“</button>
        ${gcalCalendars ? "" : `<button class="btn small" data-action="gcal-connect">Ühenda uuesti</button>`}
      </div>
      <label class="setting"><span>Saada ülesanded ja kontrolltööd Google'isse</span><input class="toggle" type="checkbox" data-field="gcal-push" ${g.push ? "checked" : ""} /></label>
      <label class="setting"><span>Näita Google'i sündmusi Kooly kalendris</span><input class="toggle" type="checkbox" data-field="gcal-pull" ${g.pull ? "checked" : ""} /></label>
      ${g.error && g.error !== "need-login" ? `<p class="error">${esc(gcalErrorText(g.error))}</p>` : ""}
      <div class="actions">
        ${g.calendarId ? `<button class="btn small primary" data-action="gcal-sync">${gcalBusy ? "Sünkroonin…" : "Sünkrooni nüüd"}</button>` : ""}
        <button class="btn small danger" data-action="gcal-disconnect">Katkesta ühendus</button>
      </div>
      ${g.lastSync ? `<p class="muted small" style="margin:10px 0 0">Viimati ${humanDay(new Date(g.lastSync))} kell ${hhmm(new Date(g.lastSync))}</p>` : ""}
    </section>
    <p class="page-lead">Soovitus: kasuta eraldi kalendrit „Kooly“ — siis on kooliasjad omaette ja neid saab Google'is ühe klikiga peita. Google'i luba kehtib tund aega; pärast seda vajuta „Sünkrooni“.</p>
    ${builtIn ? "" : setup}`;
}

function handleGcalField(el) {
  const g = state.gcal;
  if (el.dataset.field === "gcal-calendar") {
    g.calendarId = el.value || null;
    g.calendarName = el.selectedOptions[0]?.textContent.replace(/ \(peamine\)$/, "") || "";
    g.events = [];
    state.tasks.forEach((t) => delete t.gcal); // в новом календаре всё создаётся заново
    save();
    if (g.calendarId) gcalSync({ interactive: true });
    else render();
    return;
  }
  if (el.dataset.field === "gcal-push") g.push = el.checked;
  if (el.dataset.field === "gcal-pull") g.pull = el.checked;
  save();
}
