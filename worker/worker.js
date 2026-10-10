// Kooly — облачный посредник (Cloudflare Worker, бесплатный план).
// Делает то же, что server.py на Mac, но без Mac:
//   POST /edupage/<школа>/<regulartt|ttviewer>/<функция>  → публичное расписание EduPage
//   GET  /page?url=<адрес>                                → HTML страницы с сайта из ALLOWED_SITES (меню столовой)
//   GET  /ping                                            → проверка из настроек Kooly
// Личных данных здесь нет: Stuudium сюда не ходит.

const EDUPAGE_PATH = /^\/edupage\/([a-z0-9-]{2,63})\/(regulartt|ttviewer)\/(regularttGetData|getTTViewerData)$/;
const MAX_PAGE_BYTES = 3_000_000;

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
