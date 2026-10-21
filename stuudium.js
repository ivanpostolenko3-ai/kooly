"use strict";

/* =========================================================
   Kodutööd Stuudiumist.
   Вход делает сам ученик в отдельном окне Chrome (пароль, Smart-ID или ID-карта) —
   Kooly пароль не видит. Дальше server.py открывает Stuudium в фоне с этой сессией
   и возвращает список заданий: POST /api/stuudium/{login|homework|logout}.
   ========================================================= */

const STUUDIUM_DEFAULT_SCHOOL = "narvaeesti";
const STUUDIUM_AUTO_SYNC_MS = 60 * 60 * 1000; // автообновление не чаще раза в час

let stuudiumBusy = false;
let stuudiumPoll = null;

function stuudiumSchool(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (/^[a-z0-9-]+$/.test(raw)) return raw;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    const m = host.match(/^([a-z0-9-]+)\.ope\.ee$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function stuudiumCall(action, school) {
  let res;
  try {
    res = await fetch(`api/stuudium/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ school }),
    });
  } catch {
    throw new Error("network");
  }
  let data = {};
  try {
    data = await res.json();
  } catch {
    // старый сервер или статичный хостинг — API нет
  }
  if (!res.ok) throw new Error(data.error || (res.status === 404 || res.status === 501 ? "no-proxy" : "network"));
  return data;
}

function stuudiumErrorText(code) {
  return (
    {
      login: "Stuudiumi sisselogimine puudub või on aegunud. Logi uuesti sisse.",
      "window-open": "Sulge enne Stuudiumi Chrome'i aken — sisselogimine jääb meelde.",
      "no-chrome": "Google Chrome'i ei leitud. Paigalda Chrome, et Stuudiumiga ühendada.",
      "no-proxy": "Käivita Kooly failiga start.command (vaja on kohalikku serverit).",
      "local-only": "Stuudiumi saab uuendada ainult arvutist, kus Kooly töötab.",
      "no-todos": "Stuudium avanes, aga kodutöid lehelt ei leitud. Lehe koopia salvestati Kooly kausta faili .stuudium-sample.html.",
      school: "Kontrolli kooli Stuudiumi aadressi (näiteks narvaeesti.ope.ee).",
    }[code] || "Stuudiumiga ei saanud ühendust. Kontrolli internetti ja proovi uuesti."
  );
}

// Слияние: новые задания добавляем, изменённые обновляем, отметки «сделано» и скрытые сохраняем.
function applyStuudium(list) {
  const seen = new Set();
  let added = 0;
  for (const hw of list) {
    const extId = "stu:" + hw.id;
    seen.add(extId);
    const subject = hw.subject ? findSubject(hw.subject) : null;
    let task = state.tasks.find((t) => t.extId === extId);
    if (!task) {
      task = { id: newId(), extId, source: "stuudium", done: false };
      state.tasks.push(task);
      added++;
    }
    task.text = hw.text;
    task.title = hw.title || "";
    task.description = hw.description || "";
    task.kind = hw.kind || "";
    task.links = hw.links || [];
    task.due = hw.date || null;
    task.subjectId = subject ? subject.id : null;
    task.subjectName = hw.subject || "";
    if (hw.done) task.done = true;
  }
  // Задания, которые исчезли из Stuudium (учитель удалил), убираем, если они ещё не сделаны и не в прошлом.
  const todayKey = dateKey(new Date());
  state.tasks = state.tasks.filter((t) => t.source !== "stuudium" || seen.has(t.extId) || t.done || (t.due && t.due < todayKey));
  return added;
}

// Общий итог синхронизации — и с Mac (server.py), и с телефона (ярлык iOS).
function applyStuudiumResult(data, at) {
  const st = state.stuudium || (state.stuudium = { school: data.school || STUUDIUM_DEFAULT_SCHOOL });
  const added = applyStuudium(data.tasks || []);
  if (data.grades?.subjects?.length) {
    const { history, ...grades } = data.grades;
    state.grades = { ...grades, updatedAt: at };
  }
  // История для статистики за месяц, полгода, год — из всех частей таблицы Stuudium.
  archiveGrades(data.grades?.history ? { subjects: data.grades.history } : data.grades);
  st.status = "connected";
  st.lastSync = at;
  st.count = (data.tasks || []).length;
  st.error = data.warning || null;
  return added;
}

// Телефон: ярлык iOS скопировал данные со страницы Stuudium — читаем буфер обмена.
async function stuudiumPaste() {
  let raw = "";
  try {
    raw = await navigator.clipboard.readText();
  } catch {
    return toast("Luba Kooly'l lõikelauda lugeda ja proovi uuesti.");
  }
  importStuudiumPayload(raw, { mode: "phone" });
}

// Приложение для iPhone присылает то же, что собирает ярлык: JSON со страницы Stuudium или KOOLY-ERR:код.
window.koolyNativeStuudium = (raw, quiet) => {
  stuudiumBusy = false;
  if (raw.startsWith("KOOLY-ERR:")) {
    state.stuudium = { ...(state.stuudium || { school: STUUDIUM_DEFAULT_SCHOOL }), mode: "native", error: raw.slice(10) === "login" ? "login" : raw.slice(10) };
    if (raw.slice(10) === "login") state.stuudium.status = "login";
    save();
    render();
    if (!quiet) toast(raw.slice(10) === "login" ? "Logi Stuudiumi sisse (Seaded → Stuudium)" : stuudiumErrorText(raw.slice(10)));
    return;
  }
  importStuudiumPayload(raw, { mode: "native", quiet });
};

function importStuudiumPayload(raw, { mode, quiet = false }) {
  if (raw.startsWith("KOOLY-ERR:")) {
    const code = raw.slice(10);
    return toast(code === "login" ? "Logi Safari's Stuudiumi sisse ja käivita otsetee uuesti." : code === "not-stuudium" ? "Käivita otsetee Stuudiumi lehel." : `Otsetee viga: ${code}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
    if (data.kooly !== "stuudium/1") throw new Error();
  } catch {
    return toast("Lõikelaual pole Stuudiumi andmeid. Käivita Safari's otsetee „Kooly“.");
  }
  const tasks = parseStuudiumTodos(data.todos || []);
  const grades = data.grades ? parseStuudiumGradePages(data.grades) : null;
  state.stuudium = { ...(state.stuudium || {}), school: data.school, mode };
  const added = applyStuudiumResult({ tasks, grades, school: data.school, warning: tasks.length ? null : "no-todos" }, data.at || Date.now());
  save();
  render();
  if (!quiet || added) toast(`Stuudium: ${plural(tasks.length, "kodutöö", "kodutööd")}${added ? `, uusi ${added}` : ""}${grades?.subjects?.length ? " ja hinded" : ""}`);
}

// Страница «Stuudium» в приложении: вход прямо в Kooly, дальше всё само.
function stuudiumNativeHtml() {
  const st = state.stuudium;
  const connected = st?.status === "connected" && st.mode === "native";
  const when = st?.lastSync ? `${humanDay(new Date(st.lastSync))} kell ${hhmm(new Date(st.lastSync))}` : null;
  return `<section class="card">
    <h2>Stuudium ${connected ? `<span class="soon-badge ok">ühendatud</span>` : ""}</h2>
    <p class="muted small" style="margin:0 0 12px">${
      connected
        ? `Kodutööd ja hinded uuenevad ise, kui avad Kooly.${when ? ` Viimati ${when}.` : ""}`
        : "Logi üks kord Stuudiumi sisse otse Kooly's (parool, Smart-ID või ID-kaart) ja märgi „Jäta mind meelde“. Edasi uueneb kõik ise."
    }</p>
    <div class="actions">
      ${connected ? `<button class="btn small primary" data-action="stuudium-native-sync">Uuenda</button>` : `<button class="btn primary" data-action="stuudium-native-login">Logi Stuudiumi sisse</button>`}
      ${connected ? `<button class="btn small" data-action="stuudium-native-login">Logi uuesti sisse</button>` : ""}
    </div>
  </section>`;
}

async function copyShortcutCode() {
  try {
    await navigator.clipboard.writeText(STUUDIUM_SHORTCUT_JS);
    toast("Kood kopeeritud — kleebi see otseteesse");
  } catch {
    toast("Kopeerimine ei õnnestunud");
  }
}

function stuudiumPhoneHtml() {
  const st = state.stuudium;
  const when = st?.lastSync ? `${humanDay(new Date(st.lastSync))} kell ${hhmm(new Date(st.lastSync))}` : null;
  return `
    <section class="card">
      <h2>Too Stuudiumist ${when ? `<span class="soon-badge ok">${plural(st.count || 0, "kodutöö", "kodutööd")}</span>` : ""}</h2>
      ${when ? `<p class="muted small" style="margin:0 0 10px">Viimati ${when}</p>` : ""}
      <ol class="steps">
        <li>Ava Safari's Stuudium ja logi sisse.</li>
        <li>Vajuta <b>Jaga</b> → <b>Kooly</b> (otsetee).</li>
        <li>Tule tagasi ja vajuta „Kleebi Stuudiumist“.</li>
      </ol>
      <div class="actions"><button class="btn primary" data-action="stuudium-paste">Kleebi Stuudiumist</button></div>
    </section>
    <details class="card setup">
      <summary><b>Otsetee seadistamine</b> <small>üks kord, umbes 2 minutit</small></summary>
      <ol class="steps">
        <li>Ava rakendus <b>Otseteed</b> (Shortcuts) ja vajuta <b>+</b>.</li>
        <li>Lisa toiming <b>„Käivita JavaScript veebilehel“</b> (Run JavaScript on Web Page). Kustuta näidiskood ja kleebi Kooly kood:</li>
      </ol>
      <div class="actions"><button class="btn small" data-action="stuudium-copy-code">Kopeeri kood</button></div>
      <ol class="steps" start="3">
        <li>Lisa toiming <b>„Kopeeri lõikelauale“</b> (Copy to Clipboard).</li>
        <li>Ava otsetee seaded (ⓘ), lülita sisse <b>„Näita jagamislehel“</b> (Show in Share Sheet) ja pane nimeks <b>Kooly</b>.</li>
      </ol>
      <p class="muted small" style="margin:10px 0 0">Otsetee loeb ainult sinu avatud Stuudiumi lehte ja kopeerib kodutööd ning hinded. Parool ega andmed ei lähe kuhugi mujale.</p>
    </details>`;
}

async function stuudiumSync({ quiet = false } = {}) {
  const st = state.stuudium;
  if (!st || stuudiumBusy) return;
  stuudiumBusy = true;
  if (currentTab === "tasks" || onSettingsPage("stuudium")) render();
  try {
    const data = await stuudiumCall("homework", st.school);
    const added = applyStuudiumResult(data, Date.now());
    if (!quiet) toast(added ? `Stuudiumist lisandus ${plural(added, "kodutöö", "kodutööd")}` : "Kodutööd on ajakohased");
  } catch (e) {
    st.error = e.message;
    if (e.message === "login") st.status = "login";
    if (!quiet) toast(stuudiumErrorText(e.message));
  } finally {
    stuudiumBusy = false;
    save();
    render();
  }
}

// Пока открыто окно входа, каждые 3 секунды спрашиваем сервер, вошёл ли ученик.
// Как только вошёл — сами забираем домашку, а сервер закрывает окно.
function stuudiumWatchLogin() {
  clearInterval(stuudiumPoll);
  const startedAt = Date.now();
  stuudiumPoll = setInterval(async () => {
    const st = state.stuudium;
    if (!st || st.status !== "login" || Date.now() - startedAt > 15 * 60 * 1000) return clearInterval(stuudiumPoll);
    if (stuudiumBusy) return;
    try {
      const res = await stuudiumCall("status", st.school);
      if (res.loggedIn) {
        clearInterval(stuudiumPoll);
        await stuudiumSync();
      }
    } catch {
      // сервер недоступен — попробуем на следующем круге
    }
  }, 3000);
}

function stuudiumAutoSync() {
  if (state.stuudium?.status === "login") return stuudiumWatchLogin();
  const st = state.stuudium;
  if (st?.status === "connected" && Date.now() - (st.lastSync || 0) > STUUDIUM_AUTO_SYNC_MS) stuudiumSync({ quiet: true });
}

async function handleStuudiumAction(action) {
  if (action === "stuudium-login") {
    const input = document.getElementById("stu-school");
    const school = stuudiumSchool(input ? input.value : state.stuudium?.school);
    if (!school) return toast(stuudiumErrorText("school"));
    try {
      await stuudiumCall("login", school);
      state.stuudium = { ...(state.stuudium || {}), school, status: "login", error: null };
      save();
      render();
      stuudiumWatchLogin();
    } catch (e) {
      toast(stuudiumErrorText(e.message));
    }
  } else if (action === "stuudium-sync") {
    stuudiumSync();
  } else if (action === "stuudium-native-login") {
    nativePost({ type: "stuudium-login", school: state.stuudium?.school || STUUDIUM_DEFAULT_SCHOOL, script: STUUDIUM_FETCH_JS });
  } else if (action === "stuudium-native-sync") {
    stuudiumBusy = true;
    render();
    nativePost({ type: "stuudium-sync", school: state.stuudium?.school || STUUDIUM_DEFAULT_SCHOOL, script: STUUDIUM_FETCH_JS });
  } else if (action === "stuudium-paste") {
    stuudiumPaste();
  } else if (action === "stuudium-copy-code") {
    copyShortcutCode();
  } else if (action === "stuudium-logout") {
    if (!confirm("Kas katkestada ühendus Stuudiumiga? Juba laaditud kodutööd jäävad alles.")) return;
    try {
      await stuudiumCall("logout", state.stuudium.school);
    } catch {
      // сессию всё равно забываем в приложении
    }
    state.stuudium = null;
    save();
    render();
  }
}

function stuudiumCardHtml() {
  const st = state.stuudium;
  const error = st?.error ? `<p class="error">${esc(stuudiumErrorText(st.error))}</p>` : "";

  if (stuudiumBusy) {
    return `<section class="card"><h2>Stuudium</h2><p class="empty">Laadin kodutöid Stuudiumist…</p></section>`;
  }

  if (!st) {
    return `<section class="card">
      <h2>Kodutööd Stuudiumist</h2>
      <p class="muted small" style="margin:0 0 12px">Kooly avab Stuudiumi eraldi Chrome'i aknas. Logi sisse nagu tavaliselt — parooli, Smart-ID või ID-kaardiga — ja märgi „Jäta mind meelde“. Kooly ei näe ega salvesta su parooli.</p>
      <label class="field-label" for="stu-school">Kooli Stuudiumi aadress</label>
      <input class="input" id="stu-school" value="${STUUDIUM_DEFAULT_SCHOOL}.ope.ee" inputmode="url" autocomplete="off" />
      <div class="actions"><button class="btn primary" data-action="stuudium-login">Ava Stuudium</button></div>
    </section>`;
  }

  if (st.status === "login") {
    return `<section class="card">
      <h2>Stuudium <span class="soon-badge">sisselogimine</span></h2>
      <ol class="steps">
        <li>Logi avanenud Chrome'i aknas Stuudiumi sisse ja märgi „Jäta mind meelde“.</li>
        <li>Ongi kõik — Kooly märkab sisselogimist ise, toob kodutööd ja sulgeb akna.</li>
      </ol>
      <p class="muted small waiting"><span class="dot-pulse"></span>Ootan sisselogimist…</p>
      ${st.error && !["login", "window-open"].includes(st.error) ? error : ""}
      <div class="actions">
        <button class="btn primary" data-action="stuudium-sync">Too kodutööd</button>
        <button class="btn" data-action="stuudium-login">Ava aken uuesti</button>
        <button class="btn" data-action="stuudium-logout">Katkesta</button>
      </div>
    </section>`;
  }

  const when = st.lastSync ? `${humanDay(new Date(st.lastSync))} kell ${hhmm(new Date(st.lastSync))}` : "—";
  return `<section class="card">
    <h2>Stuudium <span class="soon-badge ok">ühendatud</span></h2>
    <p class="import-meta">${esc(st.school)}.ope.ee · ${plural(st.count || 0, "kodutöö", "kodutööd")}<br><span class="muted small">uuendatud ${when}</span></p>
    ${error}
    <div class="actions">
      <button class="btn small primary" data-action="stuudium-sync">Uuenda</button>
      <button class="btn small" data-action="stuudium-logout">Katkesta ühendus</button>
    </div>
  </section>`;
}
