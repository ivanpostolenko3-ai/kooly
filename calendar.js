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
const GCAL_PAST_DAYS = 30;
const GCAL_FUTURE_DAYS = 120;

let calMonth = null; // первый день показываемого месяца
let calSelected = null; // выбранный день (YYYY-MM-DD)
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

function dayDots(key) {
  const tasks = dayTasks(key).filter((t) => !t.done);
  const dots = [];
  if (tasks.some(isTest)) dots.push("test");
  if (tasks.some((t) => !isTest(t))) dots.push("task");
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
  const events = dayGoogleEvents(calSelected);
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
      <div class="cal-legend"><span><i class="dot dot-test"></i>kontrolltöö</span><span><i class="dot dot-task"></i>ülesanne</span>${g?.calendarId && g?.pull ? `<span><i class="dot dot-google"></i>Google</span>` : ""}
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
}

function gcalEventHtml(e) {
  const time = e.allDay ? "Terve päev" : `${hhmm(new Date(e.start))}–${hhmm(new Date(e.end))}`;
  return `<li class="gcal-event"><span class="gcal-bar"></span><span class="grow"><b>${esc(e.summary || "(pealkirjata)")}</b><small>${time}${e.location ? ` · ${esc(e.location)}` : ""}</small></span></li>`;
}

function handleCalendarAction(action, btn) {
  if (action === "cal-pick") {
    calSelected = btn.dataset.day;
    const d = fromKey(calSelected);
    calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  } else if (action === "cal-month") {
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + Number(btn.dataset.step), 1);
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
  }
  render();
}

/* ---------- Событие календаря из задания ---------- */

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
      client_id: state.gcal.clientId,
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
  const input = document.getElementById("gcal-client");
  if (input) {
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
  state.gcal = clientId ? { clientId, push: true, pull: true } : null;
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

    const byTask = new Map();
    const external = [];
    for (const ev of events) {
      const taskId = ev.extendedProperties?.private?.koolyTask;
      if (taskId) byTask.set(taskId, ev);
      else if (ev.status !== "cancelled") external.push(ev);
    }

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
      const ev = t.gcal?.id ? byTask.get(t.id) : null;
      if (t.gcal?.id && ev?.status === "cancelled") {
        t.gcal.removed = true; // удалили в Google — больше не создаём
        continue;
      }
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
      const body = { ...taskEvent(t), extendedProperties: { private: { koolyTask: t.id } } };
      const sig = eventSig(body);
      if (ev && t.gcal?.sig === sig) continue; // ничего не поменялось
      const saved = ev
        ? await gapi(`/calendars/${cal}/events/${encodeURIComponent(ev.id)}`, { method: "PATCH", body })
        : await gapi(`/calendars/${cal}/events`, { method: "POST", body });
      t.gcal = { id: saved.id, etag: saved.etag, sig };
      pushed++;
    }

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
    if (!quiet) toast(`Google Kalender sünkroonitud${pushed ? ` · saadetud ${pushed}` : ""}${pulled ? ` · muudetud ${pulled}` : ""}`);
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

  if (!g.clientId || !g.granted) {
    return `${setup}
      <section class="card">
        <p class="muted small" style="margin:0 0 12px">Kooly paneb kodutööd ja kontrolltööd sinu Google Kalendrisse ning näitab Google'i sündmusi Kooly kalendris. Muudatused liiguvad mõlemas suunas.</p>
        <button class="btn primary" data-action="gcal-connect">Ühenda Google Kalender</button>
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
    ${setup}`;
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
