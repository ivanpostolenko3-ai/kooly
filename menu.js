"use strict";

/* =========================================================
   Söökla menüü — недельное меню со школьного сайта.
   Сервер (POST /api/menu) сам находит страницу меню по адресу сайта и разбирает её.
   state.menu = { site, data: { weekStart, days, pdf, source }, updatedAt, error }
   ========================================================= */

const MENU_DEFAULT_SITE = "nerg.ee";
const MENU_REFRESH_MS = 3 * 60 * 60 * 1000; // обновляем не чаще раза в 3 часа

let menuBusy = false;

async function menuSync({ quiet = false } = {}) {
  if (menuBusy) return;
  const site = state.menu?.site || MENU_DEFAULT_SITE;
  menuBusy = true;
  if (onSettingsPage("menu")) render();
  try {
    const data = await loadSchoolMenu(site);
    state.menu = { ...(state.menu || {}), site, data, updatedAt: Date.now(), error: null };
    if (!quiet) toast("Menüü uuendatud");
  } catch (e) {
    state.menu = { ...(state.menu || { site }), error: e.message, updatedAt: Date.now() };
    if (!quiet) toast(menuErrorText(e.message));
  } finally {
    menuBusy = false;
    save();
    if (["now", "tomorrow"].includes(currentTab) || onSettingsPage("menu")) render();
  }
}

function menuAutoSync() {
  const m = state.menu;
  if (m?.off || !hasProxy()) return;
  if (!m || Date.now() - (m.updatedAt || 0) > MENU_REFRESH_MS) menuSync({ quiet: true });
}

function menuErrorText(code) {
  return (
    {
      site: "Kontrolli kooli veebilehe aadressi (näiteks nerg.ee).",
      "no-menu": "Sellelt lehelt nädalamenüüd ei leitud.",
      "no-proxy": "Menüü laadimiseks lisa pilveühendus (Seaded → Ühendus) või käivita Kooly arvutis.",
      "not-allowed": "Pilveühendus ei luba seda saiti. Lisa see Workeri seadesse ALLOWED_SITES.",
    }[code] || "Menüüd ei õnnestunud laadida. Kontrolli internetti."
  );
}

function menuForDay(day) {
  return state.menu?.data?.days?.find((d) => d.date === dateKey(day)) || null;
}

// Allergeenide tähised (G, L, PT…) — мелким шрифтом после блюда.
function dishHtml(text) {
  const m = text.match(/^(.*?)\s*(\(([A-ZÕÄÖÜ]{1,3}(?:,\s*[A-ZÕÄÖÜ]{1,3})*)\))$/);
  return m ? `${esc(m[1])} <span class="allergens">${esc(m[3])}</span>` : esc(text);
}

function lunchCardHtml(day, title) {
  const menu = state.menu;
  if (!menu || menu.off) return "";
  const entry = menuForDay(day);
  if (!entry) {
    // Меню ещё не вывесили (обычно новое появляется в понедельник утром).
    if (!menu.data?.weekStart) return "";
    return `<section class="card lunch"><h2>${title}</h2><p class="empty">Selle päeva menüüd pole veel avaldatud</p></section>`;
  }
  const main = entry.main.length ? entry.main : entry.sides.slice(0, 1);
  return `<section class="card lunch">
    <h2>${title}${entry.notes.length ? ` <span class="soon-badge">${esc(entry.notes[0])}</span>` : ""}</h2>
    ${main.map((d) => `<div class="lunch-main">${dishHtml(d)}</div>`).join("")}
    ${entry.veg.length ? `<div class="lunch-veg"><span>Taimetoit</span>${entry.veg.map(dishHtml).join(", ")}</div>` : ""}
    ${entry.sides.length ? `<details class="lunch-sides"><summary>Lisandid (${entry.sides.length})</summary><ul>${entry.sides.map((s) => `<li>${dishHtml(s)}</li>`).join("")}</ul></details>` : ""}
  </section>`;
}

function menuPageHtml() {
  const m = state.menu || { site: MENU_DEFAULT_SITE };
  const d = m.data;
  const when = m.updatedAt ? `${humanDay(new Date(m.updatedAt))} kell ${hhmm(new Date(m.updatedAt))}` : "—";
  return `
    <section class="card">
      <label class="field-label" for="menu-site">Kooli veebileht</label>
      <form class="composer" id="menu-form" autocomplete="off">
        <input class="input" id="menu-site" value="${esc(m.site || MENU_DEFAULT_SITE)}" inputmode="url" />
        <button class="btn primary" type="submit">${menuBusy ? "Laadin…" : "Laadi"}</button>
      </form>
      ${m.error ? `<p class="error">${esc(menuErrorText(m.error))}</p>` : ""}
      ${
        d?.days?.length
          ? `<p class="import-meta" style="margin-top:12px">Nädal alates ${shortDate(d.weekStart)} · ${plural(d.days.length, "päev", "päeva")}<br>
              <span class="muted small">uuendatud ${when}${d.pdf ? ` · <a href="${esc(d.pdf)}" target="_blank" rel="noopener">detailne menüü (PDF)</a>` : ""}</span></p>`
          : ""
      }
      <label class="setting"><span>Näita lõunamenüüd</span><input class="toggle" type="checkbox" data-field="menu-on" ${m.off ? "" : "checked"} /></label>
    </section>
    <p class="page-lead">Kooly leiab kooli lehelt nädalamenüü ise ja näitab homset lõunat vahekaardil „Homme“. Uus nädal ilmub tavaliselt esmaspäeva hommikul.</p>`;
}

function bindMenuPage() {
  document.getElementById("menu-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const site = document.getElementById("menu-site").value.trim();
    if (!site) return;
    state.menu = { ...(state.menu || {}), site, off: false };
    menuSync();
  });
}
