"use strict";

/* =========================================================
   Ühendus — откуда Kooly берёт данные из интернета.
   Браузер не может сам читать EduPage и сайт школы (они не разрешают CORS), поэтому нужен посредник:
   - на Mac: локальный server.py  →  api/edupage/…, api/page?url=…
   - на телефоне: бесплатный Cloudflare Worker (папка worker/)  →  <worker>/edupage/…, <worker>/page?url=…
   Разбор меню и страниц Stuudium делается здесь, прямо в приложении.
   ========================================================= */

// Облачный посредник по умолчанию (развёрнут из папки worker/). В Seaded → Ühendus можно указать другой.
const DEFAULT_PROXY_URL = "https://kooly-proxy.ivanpostolenko3.workers.dev";

const proxyUrl = () => state.proxyUrl || DEFAULT_PROXY_URL;

// Есть ли посредник вообще (сервер на Mac или облачный Worker).
function hasProxy() {
  return hasServer || Boolean(proxyUrl());
}

function proxyBase() {
  return hasServer ? "api" : proxyUrl().replace(/\/+$/, "");
}

function edupageEndpoint(school, file, func) {
  return `${proxyBase()}/edupage/${school}/${file}/${func}`;
}

// HTML страницы сайта школы через посредника. Возвращает { text, url } (url — после редиректов).
async function fetchPage(url) {
  if (!hasProxy()) throw new Error("no-proxy");
  let res;
  try {
    res = await fetch(`${proxyBase()}/page?url=${encodeURIComponent(url)}`);
  } catch {
    throw new Error("network");
  }
  if (res.status === 403) throw new Error("not-allowed");
  if (res.status === 404 || res.status === 501) throw new Error("no-proxy");
  if (!res.ok) throw new Error("network");
  return { text: await res.text(), url: res.headers.get("X-Final-Url") || url };
}

async function checkProxy(url) {
  const res = await fetch(`${url.replace(/\/+$/, "")}/ping`);
  const data = await res.json();
  return data.ok === true;
}

const parseHtml = (html) => new DOMParser().parseFromString(html, "text/html");
const cleanText = (el) => (el?.textContent || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

/* ---------- Söökla menüü: разбор страницы школы ---------- */

const ET_WEEKDAYS_FULL = ["esmaspäev", "teisipäev", "kolmapäev", "neljapäev", "reede", "laupäev", "pühapäev"];

function siteUrl(raw) {
  const s = String(raw || "").trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

// Ссылка «Nädalamenüü» / «Menüü» / «Toitlustus» в меню сайта.
function findMenuPage(html, base) {
  let best = null;
  for (const a of parseHtml(html).querySelectorAll("a[href]")) {
    const label = cleanText(a).toLowerCase();
    const score = label.includes("nädalamenüü") ? 3 : label.includes("menüü") ? 2 : label.includes("toitlustus") ? 1 : 0;
    if (score && (!best || score > best.score)) best = { score, href: new URL(a.getAttribute("href"), base).href.split("#")[0] };
  }
  return best?.href || null;
}

// «05.10-09.10.2026» и таблица: строка с днём недели, потом «Lõunasöök», «Taimetoit», гарниры.
function parseSchoolMenu(html, base) {
  const doc = parseHtml(html);
  const m = cleanText(doc.body).match(/(\d{1,2})\.(\d{1,2})\.?(?:\d{4})?\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  const [d1, m1, , m2, year] = m.slice(1).map(Number);
  const start = new Date(year - (m1 > m2 ? 1 : 0), m1 - 1, d1);
  const pdf = [...doc.querySelectorAll("a[href]")].find((a) => /\.pdf$/i.test(a.getAttribute("href")) && /men/i.test(a.getAttribute("href")));
  const days = [];
  for (const tr of doc.querySelectorAll("tr")) {
    const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH").map(cleanText);
    if (!cells.some(Boolean)) continue;
    const first = cells[0].toLowerCase();
    const index = ET_WEEKDAYS_FULL.indexOf(first);
    if (index >= 0) {
      days.push({ date: dateKey(addDays(start, index)), weekday: cells[0], main: [], veg: [], sides: [], notes: [] });
      continue;
    }
    const day = days[days.length - 1];
    if (!day) continue;
    const value = cells.length > 1 ? cells[cells.length - 1] : "";
    if (first === "lõunasöök" && value) day.main.push(value);
    else if (first === "taimetoit" && value) day.veg.push(value);
    else if (first && !value) day.notes.push(cells[0]); // например «Taimne lõuna»
    else if (value) first ? day.notes.push(`${cells[0]}: ${value}`) : day.sides.push(value);
  }
  return days.length ? { weekStart: dateKey(start), days, pdf: pdf ? new URL(pdf.getAttribute("href"), base).href : null } : null;
}

async function loadSchoolMenu(site) {
  let page = await fetchPage(siteUrl(site));
  let menu = parseSchoolMenu(page.text, page.url);
  if (!menu) {
    const link = findMenuPage(page.text, page.url);
    if (link) {
      page = await fetchPage(link);
      menu = parseSchoolMenu(page.text, page.url);
    }
  }
  if (!menu) throw new Error("no-menu");
  return { ...menu, source: page.url };
}

/* ---------- Stuudium: разбор того, что принёс ярлык iOS ---------- */

function textLines(node) {
  const c = node.cloneNode(true);
  c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
  c.querySelectorAll("p,div,li,h1,h2,h3,h4,tr").forEach((e) => e.append("\n"));
  return c.textContent
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function shortHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// Задания с главной страницы: div.todo_container[data-date] > a.subject_name + span.todo_content.
function parseStuudiumTodos(items) {
  const tasks = [];
  for (const item of items) {
    const box = parseHtml(item.html).querySelector(".todo_container");
    const content = box?.querySelector(".todo_content");
    if (!content) continue;
    const raw = (box.getAttribute("data-date") || "").replace(/\D/g, "");
    const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null;
    const subject = cleanText(box.querySelector(".subject_name"));
    const badge = [...box.querySelectorAll("*")].find((e) => [...e.classList].some((c) => c.includes("badge") || c.endsWith("_type")));
    const kind = cleanText(badge);
    const lines = textLines(content).filter((l) => l !== kind);
    const titleEl = [...box.querySelectorAll("*")].find((e) => [...e.classList].some((c) => c.includes("title")));
    const title = titleEl ? cleanText(titleEl) : lines[0] || "";
    const links = [...content.querySelectorAll("a[href^='http']")].map((a) => ({ text: cleanText(a) || a.href, href: a.getAttribute("href") }));
    const text = lines.join(" ");
    tasks.push({
      id: box.getAttribute("data-todo-id") || box.getAttribute("data-id") || shortHash(`${date}|${subject}|${text}`),
      date, subject, title, kind, links, text,
      description: lines.filter((l) => l !== title).join("\n"),
      done: Boolean(item.marked) || box.classList.contains("is_marked"),
    });
  }
  return tasks;
}

// Таблица «Minu hinded»: строка на предмет, ячейка td.lesson_ГГГГММДД, оценка span.grade > .grade_95.
function parseStuudiumGrades(html, period) {
  const doc = parseHtml(`<table>${html}</table>`);
  const subjects = [];
  const courses = [];
  for (const tr of doc.querySelectorAll("tr")) {
    const th = [...tr.children].find((c) => c.tagName === "TH");
    const tds = [...tr.children].filter((c) => c.tagName === "TD");
    if (!th || !tds.length) continue;
    const link = th.querySelector("a[href*='/subjects/']");
    const finalTd = tds.find((td) => td.classList.contains("lesson_final"));
    const final = cleanText(finalTd);
    if (!link) {
      if (cleanText(th) && final) courses.push({ name: cleanText(th), final });
      continue;
    }
    const subject = { name: cleanText(link), final, grades: [] };
    for (const td of tds) {
      const day = [...td.classList].map((c) => c.match(/^lesson_(\d{8})$/)).find(Boolean)?.[1];
      if (!day) continue;
      const topic = cleanText(td.querySelector(".lesson_notes")).slice(0, 200);
      for (const grade of td.querySelectorAll(".grade")) {
        const valueEl = [...grade.querySelectorAll("*")].find((e) => [...e.classList].some((c) => /^grade_[A-Z0-9]+$/.test(c)));
        if (!valueEl) continue;
        const value = cleanText(valueEl);
        subject.grades.push({
          date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`,
          value,
          numeric: /^\d+$/.test(value) ? Number(value) : null,
          active: valueEl.classList.contains("grade_active"),
          note: cleanText(grade.querySelector(".grade_notes")),
          comment: (grade.querySelector(".grade_param_has_comment")?.getAttribute("data-note") || "").trim(),
          topic,
        });
      }
    }
    subject.grades.sort((a, b) => a.date.localeCompare(b.date));
    subjects.push(subject);
  }
  return { period: period || "", subjects, courses };
}

// Код для ярлыка iOS «Выполнить JavaScript на веб-странице»: собирает домашку и оценки со страницы Stuudium.
const STUUDIUM_SHORTCUT_JS = `(async () => {
  try {
    if (!/\\.ope\\.ee$/.test(location.hostname)) return completion("KOOLY-ERR:not-stuudium");
    const base = location.origin;
    const get = async (u) => new DOMParser().parseFromString(await (await fetch(u, { credentials: "include" })).text(), "text/html");
    const home = await get(base + "/");
    if (home.querySelector("#main_login_form")) return completion("KOOLY-ERR:login");
    const todos = [...home.querySelectorAll(".todo_container")].map((e) => ({ html: e.outerHTML, marked: !!e.closest(".is_marked") }));
    const a = [...home.querySelectorAll("a[href]")].find((x) => /^hinded$/i.test(x.textContent.trim()) || /\\/grades\\/student\\//.test(x.getAttribute("href")));
    let grades = null;
    if (a) {
      const g = await get(new URL(a.getAttribute("href"), base));
      const t = g.querySelector("table.student_lessons_grades");
      const p = [...g.querySelectorAll("h3")].map((x) => x.textContent.trim()).find((x) => /\\d+\\.\\d+\\s*[—–-]/.test(x));
      grades = { html: t ? t.innerHTML : "", period: p || "" };
    }
    completion(JSON.stringify({ kooly: "stuudium/1", school: location.hostname.split(".")[0], at: Date.now(), todos, grades }));
  } catch (e) {
    completion("KOOLY-ERR:" + e.message);
  }
})();`;
