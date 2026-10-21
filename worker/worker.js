// Kooly — облачный посредник (Cloudflare Worker, бесплатный план).
// Делает то же, что server.py на Mac, но без Mac:
//   POST /edupage/<школа>/<regulartt|ttviewer>/<функция>  → публичное расписание EduPage
//   GET  /page?url=<адрес>                                → HTML страницы с сайта из ALLOWED_SITES (меню столовой)
//   GET  /ping                                            → проверка из настроек Kooly
//   POST /voice                                           → ИИ-диктовка: аудио → текст (Whisper) → задание (Llama), как Typeless
//   GET  /games/ws?school=<школа>  (WebSocket)            → «Mängud»: онлайн-игры с учениками своей школы (games.js)
// Личных данных здесь нет: Stuudium сюда не ходит.

import { GameLobby } from "./games.js";

export { GameLobby };

// Школы, для которых открыты онлайн-игры (id = поддомен Stuudium/EduPage).
const GAME_SCHOOLS = ["narvaeesti"];

const EDUPAGE_PATH = /^\/edupage\/([a-z0-9-]{2,63})\/(regulartt|ttviewer)\/(regularttGetData|getTTViewerData)$/;
const MAX_PAGE_BYTES = 3_000_000;
const MAX_AUDIO_BYTES = 6_000_000;
// ИИ-диктовку можно звать только со страниц Kooly (чтобы чужие не расходовали бесплатный лимит).
const VOICE_ORIGINS = ["https://ivanpostolenko3-ai.github.io", "http://localhost:8000"];
const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const TASK_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    subject: { type: ["string", "null"] },
    due: { type: ["string", "null"] },
    kind: { type: "string" },
  },
  required: ["title", "subject", "due", "kind"],
};

async function voiceToTask(request, env) {
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return { error: "empty-audio" };
  if (audio.byteLength > MAX_AUDIO_BYTES) return { error: "too-long" };
  let ctx = {};
  try {
    ctx = JSON.parse(decodeURIComponent(request.headers.get("X-Kooly-Context") || "%7B%7D"));
  } catch {}

  // 1. Речь → текст (русский, эстонский, английский — язык определяется сам).
  const stt = await env.AI.run(STT_MODEL, { audio: toBase64(audio), vad_filter: true });
  const text = (stt?.text || "").trim();
  if (!text) return { error: "no-speech" };
  const cyrillic = (text.match(/[а-яё]/gi) || []).length;
  const latin = (text.match(/[a-zõäöüšž]/gi) || []).length;
  const langCode = stt?.transcription_info?.language || (cyrillic > latin ? "ru" : "et");
  const language = { ru: "Russian", et: "Estonian", en: "English", uk: "Ukrainian", fi: "Finnish" }[langCode] || (cyrillic > latin ? "Russian" : "Estonian");

  // 2а. Из текста — предмет, срок и тип (контрольная или нет).
  const subjects = (ctx.subjects || []).slice(0, 40);
  const extractSystem = [
    "You extract fields from a school student's spoken NOTE. Reply with JSON only.",
    "subject: exactly one name from SUBJECTS the note is about (match across languages and slang:",
    "  математика/мата/mata → the maths subject, физра/физкультура/kehaline → PE, англ → English, химия → chemistry), otherwise null.",
    "due: deadline as YYYY-MM-DD, resolving завтра, послезавтра, к пятнице, на следующей неделе, homme, reedeks",
    "  relative to TODAY. A weekday means its next occurrence after today. null if there is no deadline.",
    "kind: \"Kontrolltöö\" if it is a test/exam/контрольная/KT/kontrolltöö, otherwise an empty string.",
    "title: any short summary (it is rewritten later).",
  ].join("\n");
  let task = { title: text, subject: null, due: null, kind: "" };
  try {
    const out = await env.AI.run(LLM_MODEL, {
      messages: [
        { role: "system", content: extractSystem },
        { role: "user", content: `TODAY: ${ctx.today || ""} (${ctx.weekday || ""})\nSUBJECTS: ${JSON.stringify(subjects)}\nNOTE: ${text}` },
      ],
      response_format: { type: "json_schema", json_schema: TASK_SCHEMA },
      max_tokens: 200,
      temperature: 0,
    });
    const parsed = typeof out?.response === "string" ? JSON.parse(out.response) : out?.response;
    if (parsed) task = { ...task, subject: parsed.subject ?? null, due: parsed.due ?? null, kind: parsed.kind || "" };
  } catch {}

  // 2б. Название — отдельно и строго на языке, на котором говорили (как Typeless: без «ну, короче, типа»).
  const fillers = /(^|\s)(э+|м+|ну|короче|типа|вот|это самое|значит|как бы|блин|мне надо|надо|e+|nagu|noh|nii|mul on vaja)(?=[\s,.!?]|$)[,.]?/gi;
  let title = text.replace(fillers, " ").replace(/\s+/g, " ").replace(/^[\s,.]+/, "").replace(/[.!]$/, "").trim();
  try {
    const out = await env.AI.run(LLM_MODEL, {
      messages: [
        {
          role: "system",
          content:
            `Rewrite the student's note as a short to-do title in ${language}. Output ONLY the title, in ${language}, no quotes. ` +
            "Remove filler words, phrases like 'мне надо'/'mul on vaja', the deadline, the subject name and the words saying it is a test. " +
            "Keep numbers that are in the note as digits. NEVER add anything that is not in the note (no invented pages, exercises or details). " +
            "Start with a capital letter, no final period. Never translate into another language.",
        },
        { role: "user", content: text },
      ],
      max_tokens: 60,
      temperature: 0,
    });
    const candidate = String(out?.response || "").trim().replace(/^["«„]|["»“]$/g, "").replace(/\.$/, "");
    const candCyr = (candidate.match(/[а-яё]/gi) || []).length;
    const candLat = (candidate.match(/[a-zõäöü]/gi) || []).length;
    const sameScript = langCode === "ru" || cyrillic > latin ? candLat <= 2 : candCyr === 0; // защита от смеси языков
    // Защита от выдумок: в названии не может быть чисел, которых не было в речи.
    const spoken = new Set(text.match(/\d+/g) || []);
    const invented = (candidate.match(/\d+/g) || []).some((n) => !spoken.has(n));
    if (candidate && candidate.length <= 120 && sameScript && !invented) title = candidate;
  } catch {}
  task.title = title.charAt(0).toUpperCase() + title.slice(1);

  if (task.subject && !subjects.includes(task.subject)) task.subject = null;
  // Запасной словарь «как говорят → как называется предмет», если ИИ предмет не узнал.
  if (!task.subject) {
    const said = text.toLowerCase();
    const map = [
      [/матем|мата|алгебр|геометр|\bmata/, /matemaatika/i],
      [/хими|keemia/, /keemia/i],
      [/физик|füüsika/, /füüsika/i],
      [/физр|физкульт|спорт|kehali|liikumis/, /kehaline|liikumis/i],
      [/англ|inglise/, /inglise/i],
      [/эстон|eesti/, /eesti keel/i],
      [/русск|vene keel/, /vene keel/i],
      [/литерат|kirjand/, /kirjandus/i],
      [/истор|ajalo/, /ajalugu/i],
      [/биолог|bioloog/, /bioloogia/i],
      [/географ|geograaf/, /geograafia/i],
      [/музык|muusik/, /muusika/i],
      [/обществ|ühiskon/, /ühiskonna/i],
      [/шведск|rootsi/, /rootsi/i],
      [/немецк|saksa/, /saksa/i],
      [/искусств|рисован|kunst/, /kunst/i],
    ];
    for (const [spoken, name] of map) {
      if (!spoken.test(said)) continue;
      const found = subjects.find((s) => name.test(s));
      if (found) {
        task.subject = found;
        break;
      }
    }
  }
  if (task.due && !/^\d{4}-\d{2}-\d{2}$/.test(task.due)) task.due = null;
  return { text, ...task };
}

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Kooly-Context",
    "Access-Control-Expose-Headers": "X-Final-Url",
    ...extra,
  };
}

function allowedSite(host, env) {
  const sites = (env.ALLOWED_SITES || "nerg.ee").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  host = host.toLowerCase();
  return sites.some((s) => host === s || host.endsWith("." + s));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    if (url.pathname === "/ping") {
      return new Response(JSON.stringify({ ok: true }), { headers: cors({ "Content-Type": "application/json" }) });
    }

    const m = url.pathname.match(EDUPAGE_PATH);
    if (m && request.method === "POST") {
      const [, school, file, func] = m;
      const body = (await request.text()).slice(0, 10_000);
      const res = await fetch(`https://${school}.edupage.org/timetable/server/${file}.js?__func=${func}`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8", "User-Agent": "Kooly/1.0" },
        body,
      });
      return new Response(res.body, { status: res.status, headers: cors({ "Content-Type": "application/json; charset=utf-8" }) });
    }

    if (url.pathname === "/games/ws") {
      // Только из Kooly (сайт и приложения открывают тот же адрес github.io).
      if (!VOICE_ORIGINS.includes(request.headers.get("Origin") || "")) return new Response("origin not allowed", { status: 403 });
      if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket expected", { status: 426 });
      const school = url.searchParams.get("school") || "";
      if (!GAME_SCHOOLS.includes(school)) return new Response("school", { status: 404 });
      return env.LOBBY.get(env.LOBBY.idFromName(school)).fetch(request);
    }

    if (url.pathname === "/voice" && request.method === "POST") {
      const origin = request.headers.get("Origin") || "";
      if (!VOICE_ORIGINS.includes(origin)) return new Response("origin not allowed", { status: 403, headers: cors() });
      try {
        const result = await voiceToTask(request, env);
        return new Response(JSON.stringify(result), { status: result.error ? 422 : 200, headers: cors({ "Content-Type": "application/json; charset=utf-8" }) });
      } catch (e) {
        return new Response(JSON.stringify({ error: "ai", detail: String(e?.message || e) }), { status: 502, headers: cors({ "Content-Type": "application/json" }) });
      }
    }

    if (url.pathname === "/page" && request.method === "GET") {
      let target;
      try {
        target = new URL(url.searchParams.get("url") || "");
      } catch {
        return new Response("bad url", { status: 400, headers: cors() });
      }
      if (!/^https?:$/.test(target.protocol) || !allowedSite(target.hostname, env)) {
        return new Response("site not allowed", { status: 403, headers: cors() });
      }
      const res = await fetch(target.toString(), {
        headers: { "User-Agent": "Mozilla/5.0 (Kooly)" },
        cf: { cacheTtl: 900, cacheEverything: true }, // меню меняется раз в неделю — кэшируем на 15 минут
      });
      const text = (await res.text()).slice(0, MAX_PAGE_BYTES);
      return new Response(text, {
        status: res.status,
        headers: cors({ "Content-Type": "text/html; charset=utf-8", "X-Final-Url": res.url }),
      });
    }

    return new Response("not found", { status: 404, headers: cors() });
  },
};
