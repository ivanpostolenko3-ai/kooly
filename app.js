"use strict";

/* =========================================================
   Kooly — школьный помощник. Интерфейс на эстонском.
   Всё хранится локально (localStorage).
   ========================================================= */

const STORAGE_KEY = "kooly.v1";
const STATE_VERSION = 2;
const DAYS = ["pühapäev", "esmaspäev", "teisipäev", "kolmapäev", "neljapäev", "reede", "laupäev"];
const DAYS_SHORT = ["P", "E", "T", "K", "N", "R", "L"];
const MONTHS = ["jaanuar", "veebruar", "märts", "aprill", "mai", "juuni", "juuli", "august", "september", "oktoober", "november", "detsember"];
const MONTHS_SHORT = ["jaan", "veebr", "märts", "apr", "mai", "juuni", "juuli", "aug", "sept", "okt", "nov", "dets"];
const TABS = ["now", "tomorrow", "tasks", "calendar", "progress", "games"];

const ICONS = {
  check: '<svg class="i" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  close: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chevron: '<svg class="i" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  chevronRight: '<svg class="i" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  chevronLeft: '<svg class="i" viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  refresh: '<svg class="i" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5"/></svg>',
  calendar: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="4"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  bag: '<svg class="i" viewBox="0 0 24 24"><path d="M5 10a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M9 6V5a3 3 0 0 1 6 0v1M5 13h14"/></svg>',
  book: '<svg class="i" viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 7h6"/></svg>',
  bell: '<svg class="i" viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  palette: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>',
  box: '<svg class="i" viewBox="0 0 24 24"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>',
  cloud: '<svg class="i" viewBox="0 0 24 24"><path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4.8 4.8 0 0 1-.5 9.5z"/></svg>',
  food: '<svg class="i" viewBox="0 0 24 24"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7h3"/></svg>',
  gear: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  mic: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  sun: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
};

/* ---------- Asjade andmebaas (каталог вещей) ----------
   perSubject — своя вещь для каждого предмета (учебник по математике ≠ учебник по физике);
   daily — берётся каждый день, независимо от уроков. */

const DEFAULT_CATALOG = [
  { id: "pinal", name: "Pinal", daily: true },
  { id: "vahetusjalatsid", name: "Vahetusjalatsid", daily: true },
  { id: "veepudel", name: "Veepudel" },
  { id: "opik", name: "Õpik", perSubject: true },
  { id: "toovihik", name: "Töövihik", perSubject: true },
  { id: "vihik", name: "Vihik", perSubject: true },
  { id: "kaust", name: "Kaust", perSubject: true },
  { id: "kalkulaator", name: "Kalkulaator" },
  { id: "joonlaud", name: "Joonlaud" },
  { id: "sirkel", name: "Sirkel" },
  { id: "spordiriided", name: "Spordiriided" },
  { id: "spordijalatsid", name: "Spordijalatsid" },
  { id: "joonistusplokk", name: "Joonistusplokk" },
  { id: "varvid", name: "Värvid" },
  { id: "pintslid", name: "Pintslid" },
  { id: "pliiatsid", name: "Värvipliiatsid" },
  { id: "sylearvuti", name: "Sülearvuti" },
  { id: "laadija", name: "Laadija" },
  { id: "korvaklapid", name: "Kõrvaklapid" },
  { id: "kontuurkaardid", name: "Kontuurkaardid" },
  { id: "raamat", name: "Ilukirjanduse raamat" },
  { id: "sonaraamat", name: "Sõnaraamat" },
];

// Вещи из старой (русской) версии → id в каталоге.
const LEGACY_ITEMS = {
  учебник: "opik",
  тетрадь: "vihik",
  "рабочая тетрадь": "toovihik",
  линейка: "joonlaud",
  калькулятор: "kalkulaator",
  "спортивная форма": "spordiriided",
  кроссовки: "spordijalatsid",
  "книга для чтения": "raamat",
  альбом: "joonistusplokk",
  краски: "varvid",
  кисточки: "pintslid",
  карандаши: "pliiatsid",
  "контурные карты": "kontuurkaardid",
};

const DEFAULT_STATE = {
  version: STATE_VERSION,
  bells: [
    { start: "08:15", end: "09:00" },
    { start: "09:10", end: "09:55" },
    { start: "10:05", end: "10:50" },
    { start: "11:10", end: "11:55" },
    { start: "12:25", end: "13:10" },
    { start: "13:20", end: "14:05" },
    { start: "14:15", end: "15:00" },
  ],
  schoolDays: 5,
  catalog: structuredClone(DEFAULT_CATALOG),
  subjects: [
    { id: "mat", name: "Matemaatika", items: ["opik", "vihik", "kalkulaator", "joonlaud"] },
    { id: "est", name: "Eesti keel", items: ["opik", "toovihik", "vihik"] },
    { id: "kir", name: "Kirjandus", items: ["raamat", "vihik"] },
    { id: "ing", name: "Inglise keel", items: ["opik", "toovihik"] },
    { id: "aja", name: "Ajalugu", items: ["opik", "vihik"] },
    { id: "bio", name: "Bioloogia", items: ["opik", "vihik"] },
    { id: "keh", name: "Kehaline kasvatus", items: ["spordiriided", "spordijalatsid"] },
    { id: "kun", name: "Kunst", items: ["joonistusplokk", "varvid", "pintslid"] },
  ],
  // 1 = esmaspäev … 6 = laupäev; в массиве — id предмета или { s, room, teacher } по звонкам (null — окно).
  timetable: {
    1: ["est", "mat", "ing", "kir", "keh"],
    2: ["mat", "est", "aja", "bio", "kun"],
    3: ["ing", "mat", "est", "kir", "keh", "aja"],
    4: ["mat", "bio", "est", "ing", "kir"],
    5: ["aja", "mat", "est", "kun", "ing"],
    6: [],
  },
  tasks: [],
  packed: {}, // { "2026-10-12": ["d:pinal", "mat:opik", "kalkulaator", …] }
  notify: false,
  notifyLead: 5,
  bagTime: "19:00",
  theme: "auto", // auto | light | dark
  source: null, // откуда импортировано расписание (EduPage)
  stuudium: null, // { school, status, lastSync, error, count, mode }
  proxyUrl: null, // адрес облачного посредника (Cloudflare Worker) для телефона
  gcal: null, // Google Kalender: { clientId, calendarId, push, pull, events, … } — см. calendar.js
  stuCal: null, // Stuudiumi kalender (Suhtlus): { url, events, lastSync, error } — iCal-лента
  fired: {}, // { "2026-10-12": ["key", …] } — какие уведомления уже показаны
};

let state = loadState();
let currentTab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "now";
let settingsPage = null; // null — меню настроек, иначе id страницы из SETTINGS_PAGES
// Есть ли локальный server.py (EduPage, Stuudium, меню). На GitHub Pages его нет — эти функции только показывают данные.
let hasServer = location.hostname === "localhost" || location.hostname === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);
let scheduleDay = Math.min(Math.max(new Date().getDay(), 1), state.schoolDays);
let lastNowSignature = "";
const openSubjects = new Set(); // какие предметы раскрыты во вкладке «Asjad»

if (location.hash) history.replaceState(null, "", location.pathname);

/* ---------- Хранилище ---------- */

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return migrate({ ...structuredClone(DEFAULT_STATE), ...saved }, saved.version);
    }
  } catch (e) {
    console.warn("Andmeid ei õnnestunud lugeda", e);
  }
  return structuredClone(DEFAULT_STATE);
}

function migrate(s, savedVersion) {
  const catalog = Array.isArray(s.catalog) ? s.catalog : [];
  for (const def of DEFAULT_CATALOG) if (!catalog.some((i) => i.id === def.id)) catalog.push({ ...def });
  s.catalog = catalog;

  for (const subject of s.subjects) {
    const ids = [];
    for (const value of subject.items || []) {
      let id = catalog.some((i) => i.id === value) ? value : LEGACY_ITEMS[String(value).toLowerCase()];
      if (!id) {
        // Неизвестная вещь из старой версии — добавляем в каталог как свою.
        const existing = catalog.find((i) => i.name.toLowerCase() === String(value).toLowerCase());
        id = existing ? existing.id : "c" + Math.random().toString(36).slice(2, 8);
        if (!existing) catalog.push({ id, name: String(value), custom: true });
      }
      if (!ids.includes(id)) ids.push(id);
    }
    subject.items = ids;
    subject.aliases = (subject.aliases || []).filter((a) => !/[а-яё]/i.test(a));
  }

  if (savedVersion !== STATE_VERSION) {
    s.packed = {};
    s.version = STATE_VERSION;
  }
  return s;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast("Andmeid ei õnnestunud seadmesse salvestada");
  }
  shareState();
  if (typeof gcalAutoSync === "function") gcalAutoSync();
}

// Kooly внутри приложения: для iPhone (ios/) WKWebView даёт window.webkit.messageHandlers.kooly,
// для Android (android/) WebView даёт window.KoolyAndroid. Сообщения у обоих одинаковые.
const isAndroidApp = Boolean(window.KoolyAndroid);
const hasNative = Boolean(window.webkit?.messageHandlers?.kooly || isAndroidApp);

function nativePost(message) {
  try {
    if (isAndroidApp) window.KoolyAndroid.post(JSON.stringify(message));
    else window.webkit.messageHandlers.kooly.postMessage(message);
  } catch {
    // не в приложении
  }
}

// Сохранить файл (копия данных, .ics). В Android WebView ссылка с download не работает — сохраняет приложение.
function saveFile(name, mime, text) {
  if (isAndroidApp) return nativePost({ type: "save-file", name, mime, text });
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Кнопка «Назад» в Android: закрыть предмет/настройки или вернуться на «Praegu». false — выйти из приложения.
window.koolyBack = () => {
  if (currentTab === "progress" && progressSubject) {
    progressSubject = null;
    render();
    return true;
  }
  if (currentTab === "settings" && settingsPage) {
    openSettings(null);
    return true;
  }
  if (currentTab !== "now") {
    switchTab("now");
    return true;
  }
  return false;
};

// Снимок расписания и задач: на Mac — серверу (таймер в строке меню, mac/KoolyMenu),
// в приложении для iPhone — нативной части (виджеты, Dynamic Island, уведомления).
let shareTimer = null;
function shareState() {
  const toServer = typeof hasServer !== "undefined" && hasServer;
  if (!toServer && !hasNative) return;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(() => {
    const snapshot = {
      updatedAt: Date.now(),
      bells: state.bells,
      schoolDays: state.schoolDays,
      timetable: state.timetable,
      subjects: state.subjects.map((s) => ({ id: s.id, name: s.name })),
      tasks: visibleTasks()
        .filter((t) => !t.done && t.due)
        .map((t) => ({ title: t.title || t.text, subject: subjectById(t.subjectId)?.name || t.subjectName || "", due: t.due, kind: t.kind || "" })),
    };
    if (toServer) fetch("api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) }).catch(() => {});
    if (hasNative) nativePost({ type: "state", snapshot: { ...snapshot, notify: state.notify, notifications: upcomingNotifications(3) } });
  }, 800);
}

// Все уведомления на ближайшие дни — приложение для iPhone ставит их в iOS, и они приходят даже при закрытом Kooly.
function upcomingNotifications(days) {
  if (!state.notify) return [];
  const now = Date.now();
  const out = [];
  for (let i = 0; i <= days; i++) {
    const day = addDays(new Date(), i);
    for (const ev of scheduledEvents(day)) {
      if (ev.at > now) out.push({ id: `${dateKey(day)}-${ev.key}`, at: ev.at, title: ev.title, body: ev.body, tab: ev.tab });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 60);
}

/* ---------- Aeg ja kuupäevad ---------- */

const pad = (n) => String(n).padStart(2, "0");

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function atTime(day, time) {
  const [h, m] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

function hhmm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function humanDay(d, today = new Date()) {
  const diff = Math.round((addDays(d, 0) - addDays(today, 0)) / 86400000);
  if (diff === 0) return "täna";
  if (diff === 1) return "homme";
  if (diff === 2) return "ülehomme";
  if (diff === -1) return "eile";
  return `${DAYS_SHORT[d.getDay()]}, ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------- Tunniplaan ---------- */

function subjectById(id) {
  return state.subjects.find((s) => s.id === id);
}

function catalogItem(id) {
  return state.catalog.find((i) => i.id === id);
}

// Ячейка расписания: id предмета или { s: id, room, teacher } после импорта из EduPage.
function entryId(entry) {
  return entry && typeof entry === "object" ? entry.s : entry;
}

function lessonsFor(day) {
  const wd = day.getDay();
  if (wd === 0 || wd > state.schoolDays) return [];
  const row = state.timetable[wd] || [];
  const lessons = [];
  row.forEach((entry, i) => {
    const bell = state.bells[i];
    const subject = subjectById(entryId(entry));
    if (!bell || !subject) return;
    lessons.push({
      n: i + 1,
      subject,
      room: entry.room || "",
      teacher: entry.teacher || "",
      start: atTime(day, bell.start),
      end: atTime(day, bell.end),
    });
  });
  return lessons;
}

function nextSchoolDay(from) {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(from, i);
    if (lessonsFor(d).length) return d;
  }
  return null;
}

function nextLessonDateOf(subjectId, from) {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(from, i);
    if (lessonsFor(d).some((l) => l.subject.id === subjectId)) return d;
  }
  return null;
}

// «Testi taimerit» в настройках: несколько минут Kooly показывает пробный урок, как будто он идёт сейчас.
let demoLesson = null;

function schoolStatus(now) {
  if (demoLesson && now < demoLesson.end) return { type: "lesson", lessons: [demoLesson], current: demoLesson, next: null };
  const lessons = lessonsFor(now);
  if (!lessons.length) return { type: "free", lessons };
  const idx = lessons.findIndex((l) => now >= l.start && now < l.end);
  if (idx !== -1) return { type: "lesson", lessons, current: lessons[idx], next: lessons[idx + 1] };
  const upIdx = lessons.findIndex((l) => l.start > now);
  if (upIdx === 0) return { type: "before", lessons, next: lessons[0] };
  if (upIdx > 0) return { type: "break", lessons, prev: lessons[upIdx - 1], next: lessons[upIdx] };
  return { type: "after", lessons };
}

// Предметы в порядке появления в расписании, потом остальные.
function subjectsInOrder() {
  const order = [];
  for (let d = 1; d <= 6; d++) for (const e of state.timetable[d] || []) if (entryId(e) && !order.includes(entryId(e))) order.push(entryId(e));
  return [...state.subjects].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
}

/* ---------- Ranits: собирается автоматически из расписания и каталога ---------- */

function bagFor(day) {
  const groups = [];
  const daily = state.catalog.filter((i) => i.daily && !i.perSubject);
  if (daily.length) groups.push({ title: "Iga päev", items: daily.map((i) => ({ key: "d:" + i.id, name: i.name })) });
  const seenShared = new Set(daily.map((i) => i.id));
  const seenSubjects = new Set();
  for (const lesson of lessonsFor(day)) {
    const subject = lesson.subject;
    if (seenSubjects.has(subject.id)) continue;
    seenSubjects.add(subject.id);
    const items = [];
    for (const id of subject.items) {
      const item = catalogItem(id);
      if (!item) continue;
      if (item.perSubject) items.push({ key: `${subject.id}:${id}`, name: item.name });
      else if (!seenShared.has(id)) {
        seenShared.add(id);
        items.push({ key: id, name: item.name });
      }
    }
    if (items.length) groups.push({ title: subject.name, items });
  }
  return groups;
}

function bagItems(day) {
  return bagFor(day).flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));
}

/* ---------- Ülesande lugemine tekstist / häälest ---------- */

const WEEKDAY_STEMS = [
  [1, "esmasp"],
  [2, "teisip"],
  [3, "kolmap"],
  [4, "neljap"],
  [5, "reede"],
  [6, "laup"],
  [0, "pühap"],
];
const MONTH_STEMS = ["jaan", "veebr", "märts", "apr", "mai", "juun", "juul", "aug", "sept", "okt", "nov", "dets"];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Совпадение с началом слова: «mata» найдётся в «mata ülesanded», но не в «tegemata».
const startsWord = (text, stem) => new RegExp(`(^|[^\\p{L}])${escapeRe(stem)}`, "u").test(text);

function subjectStems(subject) {
  const name = subject.name.toLowerCase().trim();
  const hint = SUBJECT_HINTS.find(([re]) => re.test(subject.name));
  return [name.length > 5 ? name.slice(0, -1) : name, ...(hint ? hint[1] : []), ...(subject.aliases || [])];
}

function findSubject(text) {
  const lower = text.toLowerCase();
  const exact = state.subjects.find((s) => s.name.toLowerCase() === lower.trim());
  if (exact) return exact;
  // Если подходят несколько предметов, берём самое длинное совпадение («vene kirjand» важнее «vene»).
  let subject = null;
  let best = 0;
  for (const s of state.subjects) {
    for (const stem of subjectStems(s)) {
      if (stem && stem.length > best && startsWord(lower, stem.toLowerCase())) {
        subject = s;
        best = stem.length;
      }
    }
  }
  return subject;
}

function parseTask(input, today = new Date()) {
  let text = input.trim().replace(/^(lisa\s+ülesanne|tuleta\s+(mulle\s+)?meelde|meeldetuletus|lisa)[:,]?\s*/i, "");
  const lower = text.toLowerCase();

  let due = null;
  let auto = false;

  if (/(^|[^\p{L}])ülehom(me|se|seks)/u.test(lower)) due = addDays(today, 2);
  else if (/(^|[^\p{L}])hom(me|se|seks|mikuks)/u.test(lower)) due = addDays(today, 1);
  else if (/(^|[^\p{L}])täna(ne|seks|se)?(?!\p{L})/u.test(lower)) due = addDays(today, 0);

  if (!due) {
    const m = lower.match(/(\d+)\s*päeva\s+pärast/);
    if (m) due = addDays(today, Number(m[1]));
  }
  if (!due) {
    const m = lower.match(new RegExp(`(\\d{1,2})\\.?\\s*(${MONTH_STEMS.join("|")})`, "u"));
    const n = lower.match(/(^|\s)(\d{1,2})\.(\d{1,2})(?!\d)/);
    if (m || n) {
      const day = Number(m ? m[1] : n[2]);
      const month = m ? MONTH_STEMS.indexOf(m[2]) : Number(n[3]) - 1;
      if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
        due = new Date(today.getFullYear(), month, day);
        if (due < addDays(today, 0)) due.setFullYear(due.getFullYear() + 1);
      }
    }
  }
  if (!due) {
    for (const [wd, stem] of WEEKDAY_STEMS) {
      if (startsWord(lower, stem)) {
        const diff = (wd - today.getDay() + 7) % 7 || 7;
        due = addDays(today, diff);
        break;
      }
    }
  }

  const subject = findSubject(lower);

  // Jaotamine: если указан предмет без даты — ставим на ближайший урок этого предмета.
  if (!due && subject) {
    due = nextLessonDateOf(subject.id, today);
    auto = Boolean(due);
  }

  return { text: capitalize(text), due: due ? dateKey(due) : null, subjectId: subject ? subject.id : null, auto };
}

function describeParsed(p) {
  const parts = [];
  const subject = p.subjectId && subjectById(p.subjectId);
  if (subject) parts.push(`📘 ${subject.name}`);
  if (p.due) parts.push(`📅 ${humanDay(fromKey(p.due))}${p.auto ? " (järgmine tund)" : ""}`);
  return parts.join(" · ");
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function addTask(input) {
  if (!input.trim()) return null;
  const task = { id: newId(), done: false, ...parseTask(input) };
  state.tasks.push(task);
  save();
  return task;
}

const visibleTasks = () => state.tasks.filter((t) => !t.dismissed);

/* ---------- Joonistamine ---------- */

const view = document.getElementById("view");

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function render() {
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === currentTab));
  document.getElementById("settings-btn").classList.toggle("active", currentTab === "settings");
  if (currentTab === "now") renderNow(true);
  else if (currentTab === "tomorrow") renderTomorrow();
  else if (currentTab === "tasks") renderTasks();
  else if (currentTab === "progress") renderProgress();
  else if (currentTab === "calendar") renderCalendar();
  else if (currentTab === "games") renderGames();
  else renderSettings();
  if (currentTab !== "games") gamesOnRender(); // онлайн «Mängud»: отключиться, если ушли с вкладки и не играем
}

function roomText(room) {
  return room ? ` · ruum ${esc(room)}` : "";
}

function lessonListHtml(lessons, now) {
  if (!lessons.length) return `<p class="empty">Tunde pole</p>`;
  return `<ul class="list">${lessons
    .map((l) => {
      const cls = now && now >= l.end ? "past" : now && now >= l.start ? "current" : "";
      return `<li class="lesson-row ${cls}">
        <span class="lesson-num">${l.n}</span>
        <span class="lesson-name">${esc(l.subject.name)}${l.room ? `<small>ruum ${esc(l.room)}</small>` : ""}</span>
        <span class="lesson-time">${hhmm(l.start)}–${hhmm(l.end)}</span>
      </li>`;
    })
    .join("")}</ul>`;
}

/* --- Praegu --- */

function renderNow(force = false) {
  const now = new Date();
  const st = schoolStatus(now);
  const signature = `${dateKey(now)}|${st.type}|${st.current?.n}|${st.next?.n}|${state.tasks.length}`;
  if (!force && signature === lastNowSignature) return;
  lastNowSignature = signature;

  let hero = "";
  if (st.type === "lesson") {
    hero = `<section class="hero lesson">
      <div class="hero-label">${st.current.n}. tund · kuni ${hhmm(st.current.end)}${roomText(st.current.room)}</div>
      <div class="hero-title">${esc(st.current.subject.name)}</div>
      <div class="timer" data-until="${+st.current.end}"></div>
      <div class="hero-sub">tunni lõpuni</div>
      <div class="progress"><div data-from="${+st.current.start}" data-to="${+st.current.end}"></div></div>
    </section>`;
  } else if (st.type === "before") {
    // До первого урока отсчёт не нужен — просто когда и что начинается.
    hero = `<section class="hero">
      <div class="hero-label">Täna</div>
      <div class="hero-title">Tunnid algavad kell ${hhmm(st.next.start)}</div>
      <div class="hero-sub">1. tund: ${esc(st.next.subject.name)}${roomText(st.next.room)}</div>
    </section>`;
  } else if (st.type === "break") {
    hero = `<section class="hero break">
      <div class="hero-label">Vahetund</div>
      <div class="hero-title">Järgmisena: ${esc(st.next.subject.name)}</div>
      <div class="timer" data-until="${+st.next.start}"></div>
      <div class="hero-sub">${st.next.n}. tunni alguseni · kell ${hhmm(st.next.start)}${roomText(st.next.room)}</div>
      <div class="progress"><div data-from="${+st.prev.end}" data-to="${+st.next.start}"></div></div>
    </section>`;
  } else {
    const nd = nextSchoolDay(now);
    hero = `<section class="hero">
      <div class="hero-label">${st.type === "after" ? "Tänased tunnid on läbi 🎉" : "Täna tunde pole 🌿"}</div>
      <div class="hero-title">${nd ? `Järgmine koolipäev: ${humanDay(nd, now)}` : "Tunniplaan on tühi"}</div>
      ${nd ? `<div class="actions"><button class="btn accent" data-goto="tomorrow">Paki ranits</button></div>` : ""}
    </section>`;
  }

  let nextCard = "";
  if (st.type === "lesson" && st.next) {
    const names = st.next.subject.items.map((id) => catalogItem(id)?.name).filter(Boolean);
    nextCard = `<section class="card">
      <h2>Järgmine tund</h2>
      <h3>${st.next.n}. ${esc(st.next.subject.name)}</h3>
      <div class="muted">${hhmm(st.next.start)}–${hhmm(st.next.end)}${roomText(st.next.room)} · vahetund ${Math.round((st.next.start - st.current.end) / 60000)} min</div>
      ${names.length ? `<div class="meta" style="margin-top:8px">${names.map((n) => `<span class="chip">${esc(n)}</span>`).join("")}</div>` : ""}
    </section>`;
  }

  const todayKey = dateKey(now);
  const todayTasks = visibleTasks().filter((t) => !t.done && t.due && t.due <= todayKey);

  view.innerHTML = `
    ${hero}
    ${nextCard}
    ${schoolEventsCardHtml(now, "Täna koolis")}
    ${st.lessons.length && now.getHours() < 14 ? lunchCardHtml(now, "Tänane lõuna") : ""}
    ${st.lessons.length ? `<section class="card"><h2>Täna, ${DAYS[now.getDay()]}</h2>${lessonListHtml(st.lessons, now)}</section>` : ""}
    <section class="card">
      <h2>Tänased ülesanded</h2>
      ${todayTasks.length ? taskListHtml(sortByDeadline(todayTasks), now) : `<p class="empty">Midagi kiiret pole 👌</p>`}
    </section>`;
  tick();
}

/* --- Homme / ranits --- */

function renderTomorrow() {
  const now = new Date();
  const day = nextSchoolDay(now);
  if (!day) {
    view.innerHTML = `<section class="card"><p class="empty">Tunniplaan on tühi. <button class="link" data-action="open-settings" data-page="schedule">Lisa tunniplaan</button></p></section>`;
    return;
  }
  const key = dateKey(day);
  const lessons = lessonsFor(day);
  const groups = bagFor(day);
  const all = groups.flatMap((g) => g.items);
  const packed = state.packed[key] || [];
  const done = all.filter((i) => packed.includes(i.key)).length;
  const dayTasks = visibleTasks().filter((t) => t.due === key);

  view.innerHTML = `
    <section class="hero date-hero">
      <div class="date-tile"><b>${day.getDate()}</b><span>${MONTHS_SHORT[day.getMonth()]}</span></div>
      <div>
        <div class="hero-label">${humanDay(day, now) === "homme" ? "Homme" : "Järgmine koolipäev"}</div>
        <div class="hero-title">${capitalize(DAYS[day.getDay()])}</div>
        <div class="hero-sub">${plural(lessons.length, "tund", "tundi")} · algus kell ${hhmm(lessons[0].start)}</div>
      </div>
    </section>
    ${schoolEventsCardHtml(day, "Koolis")}
    ${lunchCardHtml(day, "Lõuna")}
    <section class="card">
      <h2>Ranits <span class="counter">${done}/${all.length}</span></h2>
      ${
        all.length
          ? groups
              .map(
                (g) => `<div class="group-title">${esc(g.title)}</div><ul class="list">${g.items
                  .map((i) => {
                    const on = packed.includes(i.key);
                    return `<li class="check-row ${on ? "done" : ""}" data-item="${esc(i.key)}" data-day="${key}">
                      <button class="check" data-action="toggle-item" aria-label="Pakitud">${on ? ICONS.check : ""}</button>
                      <span class="grow text">${esc(i.name)}</span>
                    </li>`;
                  })
                  .join("")}</ul>`
              )
              .join("")
          : `<p class="empty">Ainetele pole veel asju valitud. <button class="link" data-action="open-settings" data-page="items">Vali asjad</button></p>`
      }
      ${done === all.length && all.length ? `<p class="all-packed">Kõik on pakitud! 🎒</p>` : ""}
      <div class="actions">
        ${all.length && done < all.length ? `<button class="btn small primary" data-action="pack-all" data-day="${key}">Märgi kõik</button>` : ""}
        ${done ? `<button class="btn small" data-action="unpack-all" data-day="${key}">Alusta otsast</button>` : ""}
        <button class="btn small ghost" data-action="open-settings" data-page="items">Muuda</button>
      </div>
    </section>
    <section class="card">
      <h2>Selleks päevaks</h2>
      ${dayTasks.length ? taskListHtml(sortByDeadline(dayTasks), now) : `<p class="empty">Selleks päevaks ülesandeid pole</p>`}
    </section>
    <section class="card">
      <h2>Tunnid</h2>
      ${lessonListHtml(lessons, null)}
    </section>`;
}

/* --- Ülesanne: tähtaeg ja kaart --- */

// Срок задания: начало урока этого предмета в день сдачи; иначе начало учебного дня; иначе конец дня.
function taskDeadline(t) {
  if (!t.due) return null;
  const day = fromKey(t.due);
  const lessons = lessonsFor(day);
  const lesson = (t.subjectId && lessons.find((l) => l.subject.id === t.subjectId)) || null;
  if (lesson) return { at: lesson.start, lesson };
  if (lessons.length) return { at: lessons[0].start, lesson: null };
  return { at: atTime(day, "23:59"), lesson: null };
}

function formatLeft(ms) {
  if (ms <= 0) return "tähtaeg möödas";
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} t ${min % 60} min` : `${h} t`;
  return h % 24 ? `${Math.floor(h / 24)} p ${h % 24} t` : `${h / 24} p`;
}

function leftClass(ms) {
  if (ms <= 0) return "late";
  if (ms < 3 * 3600000) return "soon";
  if (ms < 24 * 3600000) return "today";
  return "";
}

function taskCardHtml(t, now = new Date()) {
  const subject = t.subjectId ? subjectById(t.subjectId) : null;
  const subjectName = subject ? subject.name : t.subjectName;
  const dl = taskDeadline(t);
  const left = dl ? dl.at - now : null;
  const title = t.title || t.text;
  const when = dl
    ? `${capitalize(humanDay(fromKey(t.due), now))}${dl.lesson ? ` · ${dl.lesson.n}. tund ${hhmm(dl.lesson.start)}` : ""}`
    : "Tähtajata";
  return `<li class="task ${t.done ? "done" : ""}" data-task="${t.id}">
    <button class="check" data-action="toggle-task" aria-label="Tehtud">${t.done ? ICONS.check : ""}</button>
    <div class="task-body">
      <div class="task-top">
        <span class="task-subject">${esc(subjectName || "Muu")}</span>
        ${t.kind ? `<span class="task-kind">${esc(t.kind)}</span>` : ""}
        ${dl && !t.done ? `<span class="task-left ${leftClass(left)}" data-deadline="${+dl.at}">${formatLeft(left)}</span>` : ""}
      </div>
      <div class="task-title">${esc(title)}</div>
      ${descriptionText(t) ? `<div class="task-desc">${esc(descriptionText(t))}</div>` : ""}
      ${(t.links || []).length ? `<div class="task-links">${t.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(linkLabel(l))}</a>`).join("")}</div>` : ""}
      <div class="task-when">${when}${t.source === "stuudium" ? " · Stuudium" : ""}</div>
    </div>
    <button class="icon-btn task-x" data-action="delete-task" aria-label="Kustuta">${ICONS.close}</button>
  </li>`;
}

// Ссылка-адрес показывается коротко — названием сайта («docs.google.com»), а не всем URL.
const URL_RE = /https?:\/\/\S+/g;

function linkLabel(link) {
  // В Stuudium текст ссылки бывает склеен с адресом: «Tera: Inspiratsioonipäevikhttps://…» — адрес убираем.
  const text = (link.text || "").replace(URL_RE, "").trim();
  if (text) return text;
  try {
    return new URL(link.href).hostname.replace(/^www\./, "");
  } catch {
    return text || "link";
  }
}

// Адреса ссылок в описании не показываем — они уже есть кнопками ниже.
function descriptionText(t) {
  if (!t.description) return "";
  const lines = t.description.split("\n").map((l) => (t.links?.length ? l.replace(URL_RE, "") : l).trim());
  const labels = new Set((t.links || []).map(linkLabel));
  return lines.filter((l) => l && !labels.has(l)).join("\n");
}

function taskListHtml(tasks, now = new Date()) {
  return `<ul class="tasks">${tasks.map((t) => taskCardHtml(t, now)).join("")}</ul>`;
}

// Порядок: по сроку (день сдачи, затем урок); задания без срока — в конце.
function sortByDeadline(tasks) {
  return [...tasks].sort((a, b) => (taskDeadline(a)?.at ?? Infinity) - (taskDeadline(b)?.at ?? Infinity));
}

/* --- Ülesanded --- */

function renderTasks() {
  const now = new Date();
  const todayKey = dateKey(now);
  const open = sortByDeadline(visibleTasks().filter((t) => !t.done));
  const done = visibleTasks().filter((t) => t.done);

  // Группы по дню сдачи: «Hilinenud», «Täna», «Homme», дальше по датам, потом «Tähtajata».
  const groups = [];
  for (const t of open) {
    const key = !t.due ? "none" : t.due < todayKey ? "late" : t.due;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const title = key === "none" ? "Tähtajata" : key === "late" ? "Hilinenud" : capitalize(humanDay(fromKey(key), now));
      groups.push((g = { key, title, items: [] }));
    }
    g.items.push(t);
  }
  groups.sort((a, b) => (a.key === "late" ? -1 : b.key === "late" ? 1 : a.key === "none" ? 1 : b.key === "none" ? -1 : a.key.localeCompare(b.key)));

  const st = state.stuudium;
  const sync = !st
    ? ""
    : hasNative
      ? `<button class="sync-pill ${stuudiumBusy ? "busy" : ""}" data-action="stuudium-native-sync">${ICONS.refresh}<span>${stuudiumBusy ? "Uuendan…" : st.lastSync ? `Stuudium · ${hhmm(new Date(st.lastSync))}` : "Stuudium"}</span></button>`
    : hasServer
      ? st.status === "connected"
        ? `<button class="sync-pill ${stuudiumBusy ? "busy" : ""}" data-action="stuudium-sync">${ICONS.refresh}<span>${stuudiumBusy ? "Uuendan…" : `Stuudium · ${hhmm(new Date(st.lastSync))}`}</span></button>`
        : ""
      : `<button class="sync-pill" data-action="stuudium-paste">${ICONS.refresh}<span>Kleebi Stuudiumist</span></button>`;

  view.innerHTML = `
    <form class="composer slim" id="task-form" autocomplete="off">
      <input class="input" id="task-input" placeholder="Lisa ülesanne: mata lk 42 reedeks" enterkeyhint="done" />
      <button type="button" class="mic" id="mic-btn" aria-label="Ütle häälega">${ICONS.mic}</button>
    </form>
    <div class="preview" id="task-preview" hidden></div>
    <div class="tasks-head"><h1 class="page-title">Ülesanded</h1>${sync}</div>
    ${groups.map((g) => `<div class="day-title ${g.key === "late" ? "late" : ""}">${g.title}</div>${taskListHtml(g.items, now)}`).join("") || `<p class="empty">Kõik tehtud 🎉</p>`}
    ${done.length ? `<details class="done-box"><summary>Tehtud (${done.length})</summary>${taskListHtml(done, now)}<div class="actions"><button class="btn small" data-action="clear-done">Eemalda tehtud</button></div></details>` : ""}`;

  const input = document.getElementById("task-input");
  const preview = document.getElementById("task-preview");
  input.addEventListener("input", () => {
    preview.hidden = !input.value.trim();
    preview.textContent = describeParsed(parseTask(input.value)) || "Aine ja kuupäevata";
  });
  document.getElementById("task-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const task = addTask(input.value);
    if (task) announceTask(task);
  });
  document.getElementById("mic-btn").addEventListener("click", startVoice);
}

function announceTask(task) {
  render();
  const info = describeParsed(task);
  toast(`Lisatud${info ? ": " + info : ""}`, "Võta tagasi", () => {
    state.tasks = state.tasks.filter((t) => t.id !== task.id);
    save();
    render();
  });
}

/* --- Häälsisestus --- */

let recognition = null;
let recorder = null;
let recordTimer = null;
const MAX_RECORD_SECONDS = 45;

// ИИ-диктовка (как Typeless): записываем голос → облачный посредник (Whisper + Llama) → готовое задание.
// Говорить можно свободно, по-русски или по-эстонски: «ну короче к пятнице по математике номер 245».
async function startVoice() {
  const btn = document.getElementById("mic-btn");
  const preview = document.getElementById("task-preview");
  if (recorder) {
    recorder.stop();
    return;
  }
  const canRecord = navigator.mediaDevices?.getUserMedia && window.MediaRecorder && proxyUrl();
  if (!canRecord) return startSpeechRecognition();

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    preview.hidden = false;
    preview.textContent = "Mikrofonile pole ligipääsu. Luba see seadetes (Kooly → Mikrofon).";
    return;
  }
  const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  const chunks = [];
  recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearInterval(recordTimer);
    btn.classList.remove("listening");
    const blob = new Blob(chunks, { type: recorder.mimeType || type || "audio/mp4" });
    recorder = null;
    if (blob.size < 1500) {
      preview.textContent = "Liiga lühike — hoia mikrofoni all ja räägi.";
      return;
    }
    sendVoice(blob);
  };
  recorder.start();
  btn.classList.add("listening");
  const started = Date.now();
  preview.hidden = false;
  const tick = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    preview.textContent = `🎙 Kuulan… ${Math.floor(secs / 60)}:${pad(secs % 60)} — räägi vabalt, vajuta uuesti, kui valmis`;
    if (secs >= MAX_RECORD_SECONDS && recorder) recorder.stop();
  };
  tick();
  recordTimer = setInterval(tick, 250);
}

async function sendVoice(blob) {
  const btn = document.getElementById("mic-btn");
  const preview = document.getElementById("task-preview");
  const now = new Date();
  const context = { today: dateKey(now), weekday: DAYS[now.getDay()], subjects: state.subjects.map((s) => s.name) };
  btn?.classList.add("thinking");
  if (preview) preview.textContent = "✨ Mõtlen…";
  try {
    const res = await fetch(`${proxyUrl().replace(/\/+$/, "")}/voice`, {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/mp4", "X-Kooly-Context": encodeURIComponent(JSON.stringify(context)) },
      body: blob,
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const subject = data.subject ? state.subjects.find((s) => s.name === data.subject) : null;
    let due = data.due || null;
    let auto = false;
    if (!due && subject) {
      const d = nextLessonDateOf(subject.id, now); // срок не назван — на ближайший урок этого предмета
      if (d) {
        due = dateKey(d);
        auto = true;
      }
    }
    const task = { id: newId(), done: false, text: data.title, title: data.title, subjectId: subject?.id || null, due, auto, kind: data.kind || "", spoken: data.text };
    state.tasks.push(task);
    save();
    announceTask(task);
  } catch (e) {
    if (preview) {
      preview.hidden = false;
      preview.textContent = e.message === "no-speech" ? "Ei kuulnud midagi — proovi uuesti." : "Ei õnnestunud. Proovi uuesti või kirjuta ülesanne.";
    }
  } finally {
    document.getElementById("mic-btn")?.classList.remove("thinking");
  }
}

// Запасной вариант без посредника: распознавание речи браузера (если оно есть).
function startSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById("mic-btn");
  const input = document.getElementById("task-input");
  const preview = document.getElementById("task-preview");

  if (!SR) {
    input.focus();
    preview.textContent = "Kõnetuvastus pole siin saadaval — vajuta klaviatuuril 🎙 ja dikteeri ülesanne.";
    return;
  }
  if (recognition) {
    recognition.stop();
    return;
  }

  recognition = new SR();
  recognition.lang = "et-EE";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let finalText = "";

  recognition.onstart = () => {
    btn.classList.add("listening");
    preview.textContent = "Kuulan… Näiteks: „reedeks matemaatika ülesanded 12 kuni 15“";
  };
  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    input.value = (finalText + interim).trim();
    preview.textContent = describeParsed(parseTask(input.value)) || "…";
  };
  recognition.onerror = (e) => {
    preview.textContent = e.error === "not-allowed" ? "Mikrofonile pole ligipääsu. Luba see brauseri seadetes." : "Ei kuulnud hästi, proovi uuesti.";
  };
  recognition.onend = () => {
    btn.classList.remove("listening");
    recognition = null;
    if (finalText.trim()) {
      const task = addTask(finalText);
      if (task) announceTask(task);
    }
  };
  recognition.start();
}

/* --- Seaded: menüü ja alamlehed --- */

const SETTINGS_PAGES = {
  schedule: { title: "Tunniplaan", icon: "calendar" },
  items: { title: "Asjad", icon: "bag" },
  stuudium: { title: "Stuudium", icon: "book" },
  menu: { title: "Söökla menüü", icon: "food" },
  gcal: { title: "Google Kalender", icon: "calendar" },
  notify: { title: "Teavitused", icon: "bell" },
  look: { title: "Välimus", icon: "palette" },
  connection: { title: "Ühendus", icon: "cloud" },
  data: { title: "Andmed", icon: "box" },
};

function settingsSummary(page) {
  switch (page) {
    case "schedule":
      return state.source?.type === "edupage" ? `EduPage · klass ${state.source.className}` : `${plural(state.subjects.length, "aine", "ainet")} · käsitsi`;
    case "items": {
      const daily = state.catalog.filter((i) => i.daily).map((i) => i.name);
      return daily.length ? `Iga päev: ${daily.join(", ")}` : "Vali, mida kooli kaasa võtta";
    }
    case "stuudium": {
      const st = state.stuudium;
      if (!st) return hasServer ? "Pole ühendatud" : "Otsetee kaudu";
      if (st.status === "login") return "Ootab sisselogimist";
      return st.lastSync ? `Ühendatud · ${humanDay(new Date(st.lastSync))} ${hhmm(new Date(st.lastSync))}` : "Ühendatud";
    }
    case "menu":
      if (state.menu?.off) return "Väljas";
      return state.menu?.data?.days?.length ? `${state.menu.site} · nädal alates ${shortDate(state.menu.data.weekStart)}` : state.menu?.site || MENU_DEFAULT_SITE;
    case "gcal":
      return state.gcal?.calendarId ? `Ühendatud · ${state.gcal.calendarName || "kalender"}` : "Pole ühendatud";
    case "notify":
      return state.notify ? `Sees · ranits kell ${state.bagTime}` : "Väljas";
    case "look":
      return { auto: "Automaatne", light: "Hele", dark: "Tume" }[state.theme];
    case "connection":
      return hasServer ? "Arvuti server" : state.proxyUrl ? "Pilv · oma aadress" : "Pilv · Kooly vaikimisi";
    case "data":
      return "Varukoopia ja lähtestamine";
  }
  return "";
}

function renderSettings() {
  if (!settingsPage) {
    view.innerHTML = `
      <h1 class="page-title">Seaded</h1>
      <nav class="menu">${Object.entries(SETTINGS_PAGES)
        .map(
          ([id, p]) => `<button class="menu-row" data-action="open-settings" data-page="${id}">
            <span class="menu-icon">${ICONS[p.icon]}</span>
            <span class="grow"><b>${p.title}</b><small>${esc(settingsSummary(id))}</small></span>
            <span class="menu-chevron">${ICONS.chevronRight}</span>
          </button>`
        )
        .join("")}</nav>`;
    return;
  }

  const head = `<div class="page-head">
      <button class="back" data-action="settings-back">${ICONS.chevronLeft}<span>Seaded</span></button>
      <h1 class="page-title">${SETTINGS_PAGES[settingsPage].title}</h1>
    </div>`;
  const body = {
    schedule: schedulePageHtml,
    items: itemsPageHtml,
    stuudium: () => (hasNative ? stuudiumNativeHtml() : hasServer ? stuudiumCardHtml() : stuudiumPhoneHtml()) + stuCalCardHtml(),
    menu: () => (hasProxy() ? "" : proxyHintHtml("Menüü")) + menuPageHtml(),
    connection: connectionPageHtml,
    gcal: gcalPageHtml,
    notify: notifyPageHtml,
    look: lookPageHtml,
    data: dataPageHtml,
  }[settingsPage]();
  view.innerHTML = head + body;
  if (settingsPage === "items") bindItemsPage();
  if (settingsPage === "menu") bindMenuPage();
  if (settingsPage === "stuudium") bindStuCal();
  if (settingsPage === "connection" && !hasServer) bindConnectionPage();
}

const onSettingsPage = (page) => currentTab === "settings" && settingsPage === page;

function openSettings(page = null) {
  currentTab = "settings";
  settingsPage = page;
  render();
  window.scrollTo(0, 0);
}

/* --- Asjad (andmebaas) --- */

function pickHtml(on, action, attrs, label) {
  return `<button class="pick ${on ? "on" : ""}" data-action="${action}" ${attrs}>${on ? ICONS.check : ICONS.plus}<span>${esc(label)}</span></button>`;
}

function itemsPageHtml() {
  const shared = state.catalog.filter((i) => !i.perSubject);
  const perSubject = state.catalog.filter((i) => i.perSubject);
  const custom = state.catalog.filter((i) => i.custom);

  const subjectCards = subjectsInOrder()
    .map((s) => {
      const names = s.items.map((id) => catalogItem(id)?.name).filter(Boolean);
      return `<details class="card subject-items" data-subject="${s.id}" ${openSubjects.has(s.id) ? "open" : ""}>
        <summary>
          <span class="grow"><b>${esc(s.name)}</b><small>${names.length ? esc(names.join(" · ")) : "Asju pole valitud"}</small></span>
          <span class="summary-icon">${ICONS.chevron}</span>
        </summary>
        <div class="pick-title">Selle aine jaoks</div>
        <div class="picks">${perSubject.map((i) => pickHtml(s.items.includes(i.id), "toggle-subject-item", `data-subject="${s.id}" data-item="${i.id}"`, i.name)).join("")}</div>
        <div class="pick-title">Muud asjad</div>
        <div class="picks">${shared
          .filter((i) => !i.daily)
          .map((i) => pickHtml(s.items.includes(i.id), "toggle-subject-item", `data-subject="${s.id}" data-item="${i.id}"`, i.name))
          .join("")}</div>
      </details>`;
    })
    .join("");

  return `
    <p class="page-lead">Vali, mida iga ainega kaasa võtta. Homne ranits pannakse sellest ise kokku.</p>
    <section class="card">
      <h2>Iga päev kaasas</h2>
      <div class="picks">${shared.map((i) => pickHtml(i.daily, "toggle-daily", `data-item="${i.id}"`, i.name)).join("")}</div>
    </section>
    <div class="section-title">Ained</div>
    ${subjectCards || `<section class="card"><p class="empty">Aineid pole. Lisa need jaotises „Tunniplaan“.</p></section>`}
    <section class="card">
      <h2>Lisa oma asi</h2>
      <form class="composer" id="item-form" autocomplete="off">
        <input class="input" id="item-name" placeholder="Näiteks: Laboritööde vihik" enterkeyhint="done" />
        <button class="btn primary" type="submit">Lisa</button>
      </form>
      <label class="setting"><span>Igal ainel oma (nagu õpik või vihik)</span><input class="toggle" type="checkbox" id="item-per-subject" /></label>
      ${custom.length ? `<div class="picks">${custom.map((i) => `<span class="pick custom"><span>${esc(i.name)}</span><button data-action="delete-item" data-item="${i.id}" aria-label="Kustuta">${ICONS.close}</button></span>`).join("")}</div>` : ""}
    </section>`;
}

function bindItemsPage() {
  view.querySelectorAll("details[data-subject]").forEach((d) =>
    d.addEventListener("toggle", () => (d.open ? openSubjects.add(d.dataset.subject) : openSubjects.delete(d.dataset.subject)))
  );
  document.getElementById("item-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("item-name").value.trim();
    if (!name) return;
    if (state.catalog.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
      toast("Selline asi on juba olemas");
      return;
    }
    state.catalog.push({ id: "c" + newId(), name: capitalize(name), custom: true, perSubject: document.getElementById("item-per-subject").checked });
    save();
    render();
    toast(`„${capitalize(name)}“ lisatud — vali see aine juures`);
  });
}

/* --- Tunniplaan --- */

function proxyHintHtml(what) {
  return `<section class="card">
    <p class="muted small" style="margin:0">${what} uueneb ise, kui Kooly'l on ühendus internetiga: telefonis tasuta pilveühendus, arvutis kohalik server.</p>
    <div class="actions"><button class="btn small primary" data-action="open-settings" data-page="connection">Seadista ühendus</button></div>
  </section>`;
}

/* --- Ühendus --- */

function connectionPageHtml() {
  if (hasServer) {
    return `<section class="card"><p class="muted small" style="margin:0">Kooly töötab sinu arvutis. Tunniplaan, menüü ja Stuudium uuenevad kohaliku serveri kaudu.</p></section>`;
  }
  return `
    <section class="card">
      <label class="field-label" for="proxy-url">Pilveühenduse aadress (Cloudflare Worker)</label>
      <form class="composer" id="proxy-form" autocomplete="off">
        <input class="input" id="proxy-url" value="${esc(state.proxyUrl || "")}" placeholder="${esc(DEFAULT_PROXY_URL)}" inputmode="url" />
        <button class="btn primary" type="submit">Salvesta</button>
      </form>
      <p class="muted small" style="margin:10px 0 0">${state.proxyUrl ? "Kasutad oma aadressi." : "Kasutad Kooly vaikimisi pilveühendust — midagi pole vaja muuta."} Tunniplaan uueneb kord päevas, menüü iga 3 tunni järel. Tühjenda väli, et minna tagasi vaikimisi aadressile.</p>
    </section>
    <p class="page-lead">Pilveühendus on tasuta väike vahendaja, mis toob EduPage'i tunniplaani ja kooli menüü otse telefoni — arvutit pole vaja. Stuudium käib otsetee kaudu (Seaded → Stuudium).</p>`;
}

function bindConnectionPage() {
  document.getElementById("proxy-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = document.getElementById("proxy-url").value.trim().replace(/\/+$/, "");
    if (!url) {
      state.proxyUrl = null;
      save();
      return render();
    }
    try {
      if (!(await checkProxy(url))) throw new Error();
    } catch {
      return toast("Selle aadressiga ühendust ei saanud. Kontrolli aadressi.");
    }
    state.proxyUrl = url;
    save();
    render();
    toast("Pilveühendus töötab ✓");
    menuAutoSync();
    edupageAutoSync();
  });
}

function schedulePageHtml() {
  const days = Array.from({ length: state.schoolDays }, (_, i) => i + 1);
  if (scheduleDay > state.schoolDays) scheduleDay = 1;
  const dayIds = (state.timetable[scheduleDay] || []).map(entryId);
  const subjectOptions = (selected) =>
    `<option value="">— vaba —</option>` +
    state.subjects.map((s) => `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");

  return `
    ${hasProxy() ? importCardHtml() : proxyHintHtml("EduPage'i tunniplaan")}

    <section class="card">
      <h2>Tunnid päevade kaupa</h2>
      <div class="day-chips">${days.map((d) => `<button data-action="pick-day" data-day="${d}" class="${d === scheduleDay ? "active" : ""}">${DAYS_SHORT[d]}</button>`).join("")}</div>
      ${state.bells
        .map((b, i) => `<div class="row">
          <span class="lesson-num">${i + 1}</span>
          <span class="lesson-time">${b.start}–${b.end}</span>
          <select class="input grow" data-field="lesson" data-index="${i}">${subjectOptions(dayIds[i] || "")}</select>
        </div>`)
        .join("")}
      <label class="setting" style="margin-top:6px"><span>Õpime ka laupäeval</span><input class="toggle" type="checkbox" data-field="six-days" ${state.schoolDays === 6 ? "checked" : ""} /></label>
    </section>

    <section class="card">
      <h2>Tunnikellad</h2>
      ${state.bells
        .map((b, i) => `<div class="row">
          <span class="lesson-num">${i + 1}</span>
          <input class="input" type="time" value="${b.start}" data-field="bell-start" data-index="${i}" />
          <span class="muted">–</span>
          <input class="input" type="time" value="${b.end}" data-field="bell-end" data-index="${i}" />
          <button class="icon-btn" data-action="remove-bell" data-index="${i}" aria-label="Kustuta tund">${ICONS.close}</button>
        </div>`)
        .join("")}
      <div class="actions"><button class="btn small" data-action="add-bell">+ Tund</button></div>
    </section>

    <section class="card">
      <h2>Ained</h2>
      ${state.subjects
        .map((s) => `<div class="row">
          <input class="input grow" value="${esc(s.name)}" data-field="subject-name" data-id="${s.id}" placeholder="Aine nimi" />
          <button class="icon-btn" data-action="remove-subject" data-id="${s.id}" aria-label="Kustuta aine">${ICONS.close}</button>
        </div>`)
        .join("")}
      <div class="actions"><button class="btn small" data-action="add-subject">+ Aine</button></div>
    </section>`;
}

/* --- Teavitused, välimus, andmed --- */

function notifyPageHtml() {
  return `
    <section class="card">
      <label class="setting"><span>Teavitused tundide ja ranitsa kohta</span><input class="toggle" type="checkbox" data-field="notify" ${state.notify ? "checked" : ""} /></label>
      <div class="setting">
        <span>Tunni algusest ja lõpust</span>
        <select class="input" data-field="lead">${[1, 2, 3, 5, 10].map((n) => `<option value="${n}" ${n === state.notifyLead ? "selected" : ""}>${n} min ette</option>`).join("")}</select>
      </div>
      <div class="setting">
        <span>Ranitsa meeldetuletus</span>
        <input class="input time-input" type="time" value="${state.bagTime}" data-field="bag-time" />
      </div>
    </section>
    <p class="page-lead">${hasNative ? "Teavitused tulevad ka siis, kui Kooly on suletud." : "iPhone'is töötavad teavitused, kui Kooly on lisatud avaekraanile (iOS 16.4+) ja on avatud või hiljuti taustale viidud."}</p>
    <section class="card">
      <h2>Proovi</h2>
      <p class="muted small" style="margin:0 0 12px">Vaata juba enne tundi, kuidas taimer ja teavitused välja näevad.</p>
      <div class="actions" style="margin-top:0">
        <button class="btn small primary" data-action="test-timer">Testi taimerit (2 min)</button>
        <button class="btn small" data-action="test-notification">Testi teavitust</button>
      </div>
      <p class="muted small" style="margin:12px 0 0">${
        hasNative
          ? isAndroidApp
            ? "Pärast „Testi taimerit“ tõmba teavituste paneel alla või lukusta telefon: taimer on Kooly teavituses."
            : "Pärast „Testi taimerit“ mine avaekraanile või lukusta telefon: taimer on Dynamic Islandil, lukustuskuval ja Kooly vidinas."
          : "Taimer ilmub vahekaardile „Praegu“. Dynamic Island ja vidinad töötavad Kooly rakenduses."
      }</p>
    </section>`;
}

function testTimer() {
  const now = new Date();
  demoLesson = { n: 1, subject: { id: "demo", name: "Proovitund", items: [] }, room: "101", start: new Date(+now - 60000), end: new Date(+now + 2 * 60000) };
  if (hasNative) nativePost({ type: "test-timer", minutes: 2 });
  toast(hasNative ? (isAndroidApp ? "Taimer käivitatud — vaata teavituste paneeli" : "Taimer käivitatud — vaata Dynamic Islandi ja lukustuskuva") : "Taimer käivitatud — vaata vahekaarti „Praegu“");
  setTimeout(() => {
    demoLesson = null;
    if (currentTab === "now") renderNow(true);
  }, 2 * 60000 + 500);
  if (!hasNative) switchTab("now");
}

async function testNotification() {
  if (hasNative) {
    nativePost({ type: "test-notification" });
    return toast("Teavitus tuleb 5 sekundi pärast — võid Kooly sulgeda");
  }
  if (!("Notification" in window)) return toast("See brauser ei toeta teavitusi. Kasuta Kooly rakendust.");
  if (Notification.permission !== "granted" && (await Notification.requestPermission()) !== "granted") return toast("Teavitused on keelatud");
  toast("Teavitus tuleb 5 sekundi pärast");
  setTimeout(() => notify("Kooly test 🔔", "Nii näevad välja Kooly teavitused.", "now"), 5000);
}

function lookPageHtml() {
  return `
    <section class="card">
      <div class="setting">
        <span>Teema</span>
        <div class="segmented">${[["auto", "Auto"], ["light", "Hele"], ["dark", "Tume"]]
          .map(([v, label]) => `<button data-action="set-theme" data-theme-value="${v}" class="${state.theme === v ? "active" : ""}">${label}</button>`)
          .join("")}</div>
      </div>
    </section>
    <p class="page-lead">„Auto“ järgib seadme heledat või tumedat režiimi.</p>`;
}

function dataPageHtml() {
  return `
    <section class="card">
      <p class="muted small" style="margin:0">Kõik andmed on ainult selles seadmes. Varukoopiaga saad need teise seadmesse viia.</p>
      <div class="actions">
        <button class="btn small" data-action="export">Salvesta koopia</button>
        <button class="btn small" data-action="import">Laadi koopia</button>
        <button class="btn small danger" data-action="reset">Lähtesta kõik</button>
      </div>
    </section>`;
}

function handleScheduleChange(el) {
  const i = Number(el.dataset.index);
  switch (el.dataset.field) {
    case "lesson": {
      const ids = state.timetable[scheduleDay] || [];
      while (ids.length <= i) ids.push(null);
      const prev = ids[i];
      // Сохраняем кабинет, если поменяли только предмет в ячейке из EduPage.
      ids[i] = el.value ? (prev && typeof prev === "object" ? { ...prev, s: el.value } : el.value) : null;
      while (ids.length && !ids[ids.length - 1]) ids.pop();
      state.timetable[scheduleDay] = ids;
      break;
    }
    case "bell-start":
      state.bells[i].start = el.value;
      break;
    case "bell-end":
      state.bells[i].end = el.value;
      break;
    case "subject-name":
      subjectById(el.dataset.id).name = el.value.trim() || "Nimetu aine";
      break;
    case "six-days":
      state.schoolDays = el.checked ? 6 : 5;
      save();
      render();
      return;
    case "notify":
      if (el.checked) enableNotifications(el);
      else state.notify = false;
      break;
    case "lead":
      state.notifyLead = Number(el.value);
      break;
    case "menu-on":
      state.menu = { ...(state.menu || { site: MENU_DEFAULT_SITE }), off: !el.checked };
      if (el.checked && !state.menu.data) menuSync({ quiet: true });
      break;
    case "bag-time":
      if (el.value) state.bagTime = el.value;
      break;
  }
  save();
  if (["bell-start", "bell-end", "subject-name"].includes(el.dataset.field)) render();
}

/* ---------- Tegevused ---------- */

function switchTab(tab) {
  currentTab = tab;
  settingsPage = null;
  progressSubject = null;
  render();
  window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".tabbar button");
  if (tab) return switchTab(tab.dataset.tab);

  const goto = e.target.closest("[data-goto]");
  if (goto) return switchTab(goto.dataset.goto);

  const tipTarget = e.target.closest("[data-tip]");
  if (tipTarget) return showChartTip(tipTarget);

  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === "open-settings") return openSettings(btn.dataset.page || null);
  if (action === "test-timer") return testTimer();
  if (action === "test-notification") return testNotification();
  if (action === "settings-back") return openSettings(null);
  if (action === "open-subject" || action === "close-subject") {
    progressSubject = action === "open-subject" ? btn.dataset.name : null;
    render();
    return window.scrollTo(0, 0);
  }
  if (action === "progress-range") {
    state.progressRange = btn.dataset.range;
    save();
    return render();
  }
  if (action.startsWith("g-")) return handleGamesAction(action, btn);
  if (action.startsWith("cal-") || action.startsWith("gcal-") || action === "ics-export" || action === "stucal-paste") return handleCalendarAction(action, btn);
  if (action.startsWith("edupage-")) return handleEdupageAction(action);
  if (action.startsWith("stuudium-")) return handleStuudiumAction(action);
  const taskRow = btn.closest("[data-task]");

  if (action === "toggle-task") {
    const t = state.tasks.find((x) => x.id === taskRow.dataset.task);
    t.done = !t.done;
  } else if (action === "delete-task") {
    const t = state.tasks.find((x) => x.id === taskRow.dataset.task);
    gcalForgetTask(t); // событие в Google Kalender тоже удаляется
    // Задание из Stuudium вернулось бы при следующей синхронизации — просто прячем его.
    if (t.source === "stuudium") t.dismissed = true;
    else state.tasks = state.tasks.filter((x) => x !== t);
  } else if (action === "clear-done") {
    state.tasks = state.tasks.filter((x) => !x.done || x.source === "stuudium");
    state.tasks.forEach((x) => x.done && (x.dismissed = true));
  } else if (action === "toggle-item") {
    const row = btn.closest("[data-item]");
    const list = state.packed[row.dataset.day] || (state.packed[row.dataset.day] = []);
    const at = list.indexOf(row.dataset.item);
    if (at === -1) list.push(row.dataset.item);
    else list.splice(at, 1);
  } else if (action === "pack-all") {
    state.packed[btn.dataset.day] = bagItems(fromKey(btn.dataset.day)).map((i) => i.key);
  } else if (action === "unpack-all") {
    state.packed[btn.dataset.day] = [];
  } else if (action === "toggle-daily") {
    const item = catalogItem(btn.dataset.item);
    item.daily = !item.daily;
  } else if (action === "toggle-subject-item") {
    const s = subjectById(btn.dataset.subject);
    const id = btn.dataset.item;
    s.items = s.items.includes(id) ? s.items.filter((x) => x !== id) : [...s.items, id];
  } else if (action === "delete-item") {
    const item = catalogItem(btn.dataset.item);
    if (!confirm(`Kas kustutada „${item.name}“ kõigilt ainetelt?`)) return;
    state.catalog = state.catalog.filter((i) => i !== item);
    state.subjects.forEach((s) => (s.items = s.items.filter((id) => id !== item.id)));
  } else if (action === "set-theme") {
    state.theme = btn.dataset.themeValue;
    applyTheme();
  } else if (action === "pick-day") {
    scheduleDay = Number(btn.dataset.day);
  } else if (action === "add-bell") {
    const last = state.bells[state.bells.length - 1];
    const start = last ? hhmm(new Date(+atTime(new Date(), last.end) + 10 * 60000)) : "08:15";
    state.bells.push({ start, end: hhmm(new Date(+atTime(new Date(), start) + 45 * 60000)) });
  } else if (action === "remove-bell") {
    const i = Number(btn.dataset.index);
    state.bells.splice(i, 1);
    Object.values(state.timetable).forEach((ids) => ids.splice(i, 1));
  } else if (action === "add-subject") {
    state.subjects.push({ id: "s" + newId(), name: "Uus aine", items: [], aliases: [] });
  } else if (action === "remove-subject") {
    const s = subjectById(btn.dataset.id);
    if (!confirm(`Kas kustutada „${s.name}“ kõigist päevadest?`)) return;
    state.subjects = state.subjects.filter((x) => x.id !== s.id);
    Object.keys(state.timetable).forEach((d) => (state.timetable[d] = state.timetable[d].map((e) => (entryId(e) === s.id ? null : e))));
  } else if (action === "export") {
    return exportData();
  } else if (action === "import") {
    return importData();
  } else if (action === "reset") {
    if (!confirm("Kas kustutada kõik ülesanded ja seaded ning taastada näidistunniplaan?")) return;
    state = structuredClone(DEFAULT_STATE);
  }
  save();
  if (currentTab === "now") renderNow(true);
  else render();
});

document.addEventListener("change", (e) => {
  if (e.target.matches('[data-field^="gcal-"]')) handleGcalField(e.target);
  else if (e.target.matches('[data-field^="ep-"]')) handleEdupageField(e.target);
  else if (e.target.matches("[data-field]")) handleScheduleChange(e.target);
});

/* ---------- Varukoopia ---------- */

function exportData() {
  saveFile(`kooly-${dateKey(new Date())}.json`, "application/json", JSON.stringify(state, null, 2));
}

function importData() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (!Array.isArray(data.bells) || !Array.isArray(data.subjects)) throw new Error("bad file");
      state = migrate({ ...structuredClone(DEFAULT_STATE), ...data }, data.version);
      save();
      render();
      toast("Andmed laaditud");
    } catch {
      toast("See pole Kooly fail");
    }
  };
  input.click();
}

/* ---------- Teavitused ---------- */

async function enableNotifications(checkbox) {
  if (hasNative) {
    state.notify = true;
    save();
    nativePost({ type: "notify-permission" });
    return;
  }
  if (!("Notification" in window)) {
    checkbox.checked = false;
    toast("Teavituste jaoks lisa Kooly iPhone'i avaekraanile: Jaga → Lisa avaekraanile.");
    return;
  }
  const result = await Notification.requestPermission();
  state.notify = result === "granted";
  checkbox.checked = state.notify;
  save();
  if (!state.notify) toast("Teavitused on seadetes keelatud");
  else notify("Kooly", "Teavitused on sisse lülitatud 👍", "now");
}

async function notify(title, body, tab = "now") {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, { body, icon: "icons/icon-192.png", tag: title + body, data: { tab } });
    const n = new Notification(title, { body });
    n.onclick = () => {
      window.focus();
      switchTab(tab);
    };
  } catch (e) {
    console.warn("Teavitust ei näidatud", e);
  }
}

function scheduledEvents(now) {
  const lead = state.notifyLead;
  const events = [];
  for (const l of lessonsFor(now)) {
    events.push({ key: `start-${l.n}`, at: +l.start - lead * 60000, title: `${l.n}. tund algab ${lead} min pärast`, body: `${l.subject.name} kell ${hhmm(l.start)}${l.room ? ` · ruum ${l.room}` : ""}`, tab: "now" });
    events.push({ key: `end-${l.n}`, at: +l.end - lead * 60000, title: `Tunni lõpuni ${lead} min`, body: l.subject.name, tab: "now" });
  }
  // Задания: за час до срока и в момент срока.
  for (const t of visibleTasks()) {
    if (t.done) continue;
    const dl = taskDeadline(t);
    if (!dl || dateKey(dl.at) !== dateKey(now)) continue;
    const subject = (t.subjectId && subjectById(t.subjectId)?.name) || t.subjectName || "Ülesanne";
    const what = t.title || t.text;
    events.push({ key: `task-${t.id}-60`, at: +dl.at - 3600000, title: `${subject}: tähtaeg 1 tunni pärast`, body: what, tab: "tasks" });
    events.push({ key: `task-${t.id}-0`, at: +dl.at, title: `${subject}: tähtaeg on käes`, body: what, tab: "tasks" });
  }

  const tomorrow = nextSchoolDay(now);
  if (tomorrow && Math.round((tomorrow - addDays(now, 0)) / 86400000) === 1) {
    const items = bagItems(tomorrow);
    const packed = state.packed[dateKey(tomorrow)] || [];
    const left = items.filter((i) => !packed.includes(i.key));
    const homework = visibleTasks().filter((t) => !t.done && t.due === dateKey(tomorrow)).length;
    const lunch = !state.menu?.off && menuForDay(tomorrow)?.main[0];
    if (left.length) {
      const names = left.slice(0, 6).map((i) => (i.group === "Iga päev" || !i.key.includes(":") ? i.name : `${i.group}: ${i.name.toLowerCase()}`));
      events.push({
        key: "bag",
        at: +atTime(now, state.bagTime),
        title: "Aeg ranits pakkida 🎒",
        body: `Homme ${plural(lessonsFor(tomorrow).length, "tund", "tundi")}${homework ? `, ${plural(homework, "kodutöö", "kodutööd")}` : ""}. Nimekiri on valmis: ${names.join(", ")}${left.length > 6 ? "…" : ""}${lunch ? ` Lõunaks: ${lunch.replace(/\s*\([^)]*\)$/, "")}.` : ""}`,
        tab: "tomorrow",
      });
    }
  }
  return events;
}

function checkNotifications(now) {
  if (hasNative) return; // в приложении уведомления ставит iOS заранее
  if (!state.notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const key = dateKey(now);
  const fired = state.fired[key] || [];
  let changed = false;
  for (const ev of scheduledEvents(now)) {
    // Срабатываем, если момент наступил не более 2 минут назад (на случай «сна» вкладки).
    if (now >= ev.at && now - ev.at < 120000 && !fired.includes(ev.key)) {
      fired.push(ev.key);
      notify(ev.title, ev.body, ev.tab);
      changed = true;
    }
  }
  if (changed) {
    state.fired = { [key]: fired };
    save();
  }
}

/* ---------- Taimer ---------- */

function tick() {
  const now = new Date();
  document.getElementById("clock").textContent = `${DAYS_SHORT[now.getDay()]} ${hhmm(now)}`;

  document.querySelectorAll("[data-deadline]").forEach((el) => {
    const left = Number(el.dataset.deadline) - now;
    el.textContent = formatLeft(left);
    el.className = `task-left ${leftClass(left)}`;
  });

  if (currentTab === "now") {
    let expired = false;
    document.querySelectorAll("[data-until]").forEach((el) => {
      const left = Number(el.dataset.until) - now;
      if (left <= 0) expired = true;
      el.textContent = formatCountdown(left);
    });
    document.querySelectorAll("[data-from]").forEach((el) => {
      const from = Number(el.dataset.from), to = Number(el.dataset.to);
      el.style.width = `${Math.min(100, Math.max(0, ((now - from) / (to - from)) * 100))}%`;
    });
    renderNow(expired);
  }
}

function toast(message, actionLabel, onAction) {
  const el = document.getElementById("toast");
  el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ""}`;
  el.hidden = false;
  if (actionLabel) {
    el.querySelector("button").onclick = () => {
      el.hidden = true;
      onAction();
    };
  }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4500);
}

/* ---------- Teema ---------- */

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function isDark() {
  return state.theme === "dark" || (state.theme === "auto" && darkQuery.matches);
}

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  const dark = isDark();
  document.querySelector('meta[name="theme-color"]').content = dark ? "#00171b" : "#f3f7f6";
}

document.getElementById("settings-btn").addEventListener("click", () => openSettings(null));
darkQuery.addEventListener("change", applyTheme);

/* ---------- Käivitus ---------- */

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW registreerimine ebaõnnestus", e));
  // Клик по уведомлению открывает нужную вкладку.
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (TABS.includes(e.data?.tab)) switchTab(e.data.tab);
  });
}

save();
applyTheme();
render();
if (hasNative) nativePost({ type: "stuudium-script", script: STUUDIUM_FETCH_JS }); // приложение запомнит свежий код для фоновых обновлений
if (hasNative) nativePost({ type: "ready" }); // приложение для iPhone убирает заставку
setInterval(() => {
  tick();
  if (state.notify) checkNotifications(new Date());
}, 1000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  render();
  if (hasServer) stuudiumAutoSync();
  menuAutoSync();
  edupageAutoSync();
  stuCalAutoSync();
  gcalStartupSync();
});
if (hasServer) stuudiumAutoSync();
menuAutoSync();
edupageAutoSync();
stuCalAutoSync();
setTimeout(gcalStartupSync, 2000);
