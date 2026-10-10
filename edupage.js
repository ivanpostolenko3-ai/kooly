"use strict";

/* =========================================================
   Импорт расписания из EduPage (публичное расписание школы).
   edupage.org не разрешает запросы из других сайтов (CORS),
   поэтому запросы идут через локальный server.py: /api/edupage/…
   ========================================================= */

const EDUPAGE_DEFAULT_URL = "https://narvaeestigymnaasium.edupage.org/timetable/view.php";

// Название предмета → эстонские сокращения для голосового ввода и что брать по умолчанию (id из каталога вещей).
const SUBJECT_HINTS = [
  [/vene kirjandus/i, ["vene kirjand"], ["raamat", "vihik"]],
  [/matemaatika/i, ["mata", "matem", "matek"], ["opik", "vihik", "kalkulaator", "joonlaud"]],
  [/eesti keel/i, ["eesti"], ["opik", "toovihik", "vihik"]],
  [/kirjandus/i, ["kirjand"], ["raamat", "vihik"]],
  [/inglise|^ik\b|\bik\b/i, ["inglise", "ingl"], ["opik", "toovihik"]],
  [/vene keel|\bvk\b/i, ["vene"], ["opik", "vihik"]],
  [/saksa/i, ["saksa"], ["opik", "toovihik"]],
  [/rootsi/i, ["rootsi"], ["opik", "toovihik"]],
  [/soome/i, ["soome"], ["opik", "toovihik"]],
  [/prantsuse/i, ["prantsuse"], ["opik", "toovihik"]],
  [/hispaania/i, ["hispaania"], ["opik", "toovihik"]],
  [/ajalugu/i, ["ajalo", "ajalu"], ["opik", "vihik"]],
  [/ühiskonna/i, ["ühiskon"], ["opik", "vihik"]],
  [/bioloogia/i, ["bioloog", "bioka"], ["opik", "vihik"]],
  [/keemia/i, ["keemi"], ["opik", "vihik", "kalkulaator"]],
  [/füüsika/i, ["füüsik"], ["opik", "vihik", "kalkulaator"]],
  [/geograafia/i, ["geograaf"], ["opik", "vihik", "kontuurkaardid"]],
  [/kehaline|liikumis/i, ["kehali", "kehka", "liikumis", "sport"], ["spordiriided", "spordijalatsid"]],
  [/kunst/i, ["kunst"], ["joonistusplokk", "varvid", "pintslid"]],
  [/muusika/i, ["muusik"], ["vihik"]],
  [/informaatika|arvuti|programm/i, ["informaatik", "arvuti", "programm"], ["sylearvuti"]],
  [/inimeseõpetus/i, ["inimeseõp"], ["vihik"]],
  [/riigikaitse/i, ["riigikaits"], ["vihik"]],
  [/uurimistöö/i, ["uurimistöö"], ["vihik"]],
];

let importDraft = null; // { url, loading, error, data, classId, chosen }

function edupageSchool(input) {
  const raw = input.trim().toLowerCase();
  if (/^[a-z0-9-]+$/.test(raw)) return raw;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    const m = host.match(/^([a-z0-9-]+)\.edupage\.org$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function edupageCall(school, file, func, args) {
  if (!hasProxy()) throw new Error("no-proxy");
  const res = await fetch(edupageEndpoint(school, file, func), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ __args: args, __gsh: "00000000" }),
  });
  if (res.status === 404 || res.status === 405 || res.status === 501) throw new Error("no-proxy");
  if (!res.ok) throw new Error("http");
  const data = await res.json();
  if (!data.r) throw new Error("bad");
  return data.r;
}

async function edupageLoad(url) {
  const school = edupageSchool(url);
  if (!school) throw new Error("url");
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; // учебный год с августа
  const viewer = await edupageCall(school, "ttviewer", "getTTViewerData", [null, year]);
  const list = viewer.regular?.timetables || [];
  const tt = list.find((t) => t.tt_num === viewer.regular.default_num) || list.filter((t) => !t.hidden).pop();
  if (!tt) throw new Error("no-tt");
  const r = await edupageCall(school, "regulartt", "regularttGetData", [null, tt.tt_num]);
  const tables = {};
  for (const t of r.dbiAccessorRes.tables) tables[t.id] = t.data_rows || [];
  return { school, ttName: tt.text, tables };
}

function edupageErrorText(e) {
  switch (e.message) {
    case "url":
      return "See ei näe välja nagu EduPage'i link. Näide: https://kool.edupage.org/timetable/";
    case "no-proxy":
      return "Import vajab ühendust: arvutis käivita Kooly failiga start.command, telefonis lisa pilveühendus (Seaded → Ühendus).";
    case "no-tt":
      return "Koolil pole selle õppeaasta tunniplaani avaldatud.";
    default:
      return e instanceof TypeError ? "Ühendus puudub. Kontrolli internetti ja et server töötab." : "Tunniplaani laadimine ebaõnnestus. Proovi uuesti.";
  }
}

// У общих уроков (например, Mentortund) бывает с десяток кабинетов — показываем первые два.
function shortList(values) {
  const list = values.filter(Boolean);
  return list.length > 2 ? `${list.slice(0, 2).join(", ")}…` : list.join(", ");
}

const indexBy = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

// Группы, между которыми ученик выбирает (язык, уровень эстонского/английского и т. п.).
function edupageGroupChoices(tables, classId) {
  const groups = indexBy(tables.groups);
  return tables.divisions
    .filter((d) => d.classid === classId && d.groupids.length > 1)
    .map((d) => {
      const list = d.groupids.map((id) => groups[id]).filter(Boolean);
      const names = list.map((g) => g.name);
      let label = "Rühm";
      if (names.every((n) => /^EK\b/i.test(n))) label = "Eesti keel";
      else if (names.every((n) => /^IK\b/i.test(n))) label = "Inglise keel";
      else if (names.some((n) => /vene|saksa|rootsi|soome|prantsuse|hispaania/i.test(n))) label = "B-võõrkeel";
      return { id: d.id, label, groups: list.map((g) => ({ id: g.id, name: g.name })) };
    });
}

function edupageBuild(tables, classId, chosen) {
  const groups = indexBy(tables.groups);
  const lessons = indexBy(tables.lessons);
  const subjects = indexBy(tables.subjects);
  const rooms = indexBy(tables.classrooms);
  const teachers = indexBy(tables.teachers);
  const periods = [...tables.periods].sort((a, b) => Number(a.period) - Number(b.period));
  const periodIndex = Object.fromEntries(periods.map((p, i) => [p.period, i]));
  const divisionOf = {};
  for (const d of tables.divisions) for (const g of d.groupids) divisionOf[g] = d.id;

  const fits = (lesson) =>
    lesson.classids.includes(classId) &&
    lesson.groupids.some((gid) => {
      const g = groups[gid];
      if (!g || g.classid !== classId) return false;
      if (g.entireclass) return true;
      const div = divisionOf[gid];
      return !chosen[div] || chosen[div] === gid;
    });

  const timetable = {};
  const used = new Set();
  let conflicts = 0;
  let count = 0;

  for (const card of tables.cards) {
    const lesson = lessons[card.lessonid];
    const pi = periodIndex[card.period];
    if (!lesson || pi === undefined || !card.days || !fits(lesson)) continue;
    const entry = {
      s: "e" + lesson.subjectid,
      room: shortList((card.classroomids || []).map((id) => rooms[id]?.name.replace(/\s*\(\d+\)$/, ""))),
      teacher: shortList((lesson.teacherids || []).map((id) => teachers[id]?.short)),
    };
    [...card.days].forEach((bit, d) => {
      if (bit !== "1") return;
      const row = timetable[d + 1] || (timetable[d + 1] = []);
      for (let k = 0; k < (lesson.durationperiods || 1); k++) {
        const slot = pi + k;
        while (row.length <= slot) row.push(null);
        if (row[slot]) {
          if (row[slot].s !== entry.s) conflicts++;
          continue;
        }
        row[slot] = entry;
        used.add(lesson.subjectid);
        count++;
      }
    });
  }

  return {
    bells: periods.map((p) => ({ start: p.starttime, end: p.endtime })),
    timetable,
    subjects: [...used].map((id) => ({ id: "e" + id, name: subjects[id]?.name || "Aine" })),
    schoolDays: Math.min(6, Math.max(5, tables.days.length)),
    conflicts,
    count,
  };
}

function applyEdupage(data, classId, chosen, url) {
  const result = edupageBuild(data.tables, classId, chosen);
  const byName = new Map(state.subjects.map((s) => [s.name.toLowerCase(), s]));
  state.subjects = result.subjects.map((s) => {
    const old = state.subjects.find((x) => x.id === s.id) || byName.get(s.name.toLowerCase());
    const hint = SUBJECT_HINTS.find(([re]) => re.test(s.name));
    return {
      id: s.id,
      name: old ? old.name : s.name,
      items: old ? old.items : hint ? [...hint[2]] : [],
      aliases: old?.aliases || [],
    };
  });
  state.bells = result.bells;
  state.schoolDays = result.schoolDays;
  state.timetable = {};
  for (let d = 1; d <= 6; d++) state.timetable[d] = result.timetable[d] || [];
  state.source = {
    type: "edupage",
    url,
    school: data.school,
    classId,
    className: data.tables.classes.find((c) => c.id === classId)?.name.trim() || "",
    groups: chosen,
    ttName: data.ttName,
    importedAt: Date.now(),
  };
  save();
  return result;
}

/* ---------- Карточка импорта во вкладке «Расписание» ---------- */

function importCardHtml() {
  const src = state.source;
  const d = importDraft;

  if (!d) {
    if (src?.type === "edupage") {
      return `<section class="card import-card">
        <h2>EduPage <span class="soon-badge ok">ühendatud</span></h2>
        <p class="import-meta"><b>Klass ${esc(src.className)}</b> · ${esc(src.school)}.edupage.org<br>
          <span class="muted small">${esc(src.ttName || "")} · uuendatud ${humanDay(new Date(src.importedAt))} kell ${hhmm(new Date(src.importedAt))}</span></p>
        <div class="actions">
          <button class="btn small primary" data-action="edupage-refresh">Uuenda</button>
          <button class="btn small" data-action="edupage-edit">Klass ja rühmad</button>
        </div>
      </section>`;
    }
    return `<section class="card import-card">
      <h2>Laadi EduPage'ist</h2>
      <p class="muted small" style="margin:0 0 12px">Kleebi kooli tunniplaani link ja vali klass — tunnid, kellaajad ja ruumid lisanduvad ise. Hiljem saad kõike allpool muuta.</p>
      <input class="input" id="ep-url" value="${esc(EDUPAGE_DEFAULT_URL)}" inputmode="url" autocomplete="off" />
      <div class="actions"><button class="btn primary" data-action="edupage-load">Laadi tunniplaan</button></div>
    </section>`;
  }

  if (d.loading) {
    return `<section class="card import-card"><h2>Laadi EduPage'ist</h2><p class="empty">Laadin tunniplaani…</p></section>`;
  }

  if (d.error) {
    return `<section class="card import-card">
      <h2>Laadi EduPage'ist</h2>
      <input class="input" id="ep-url" value="${esc(d.url)}" inputmode="url" autocomplete="off" />
      <p class="error">${esc(d.error)}</p>
      <div class="actions">
        <button class="btn primary" data-action="edupage-load">Proovi uuesti</button>
        <button class="btn" data-action="edupage-cancel">Loobu</button>
      </div>
    </section>`;
  }

  const { tables } = d.data;
  const classes = [...tables.classes].sort((a, b) => a.name.localeCompare(b.name, "et", { numeric: true }));
  const choices = d.classId ? edupageGroupChoices(tables, d.classId) : [];
  let preview = "";
  if (d.classId) {
    const r = edupageBuild(tables, d.classId, d.chosen);
    const rows = Object.entries(r.timetable)
      .map(([wd, row]) => {
        const names = row.map((e) => (e ? tables.subjects.find((s) => "e" + s.id === e.s)?.name : "—"));
        return `<li><b>${DAYS_SHORT[wd]}</b><span>${esc(names.join(" · "))}</span></li>`;
      })
      .join("");
    preview = `<ul class="import-preview">${rows}</ul>
      <p class="muted small" style="margin:8px 0 0">${r.count} tundi nädalas · ${r.bells.length} tunnikella: ${r.bells[0]?.start}–${r.bells[r.bells.length - 1]?.end}</p>
      ${r.conflicts ? `<p class="error">${r.conflicts} tundi kattuvad — vali ülal oma rühmad.</p>` : ""}`;
  }

  return `<section class="card import-card">
    <h2>Laadi EduPage'ist</h2>
    <p class="muted small" style="margin:0 0 12px">${esc(d.data.school)}.edupage.org · ${esc(d.data.ttName)}</p>
    <label class="field-label">Klass</label>
    <select class="input" data-field="ep-class">
      <option value="">— vali klass —</option>
      ${classes.map((c) => `<option value="${c.id}" ${c.id === d.classId ? "selected" : ""}>${esc(c.name.trim())}</option>`).join("")}
    </select>
    ${choices
      .map(
        (c) => `<label class="field-label">${esc(c.label)}</label>
      <select class="input" data-field="ep-group" data-div="${c.id}">
        <option value="">Ei tea — näita kõiki</option>
        ${c.groups.map((g) => `<option value="${g.id}" ${d.chosen[c.id] === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}
      </select>`
      )
      .join("")}
    ${preview}
    <div class="actions">
      <button class="btn primary" data-action="edupage-apply" ${d.classId ? "" : "disabled"}>Rakenda</button>
      <button class="btn" data-action="edupage-cancel">Loobu</button>
    </div>
    ${state.source ? "" : `<p class="muted small" style="margin:10px 0 0">Praegune tunniplaan asendatakse. Samanimeliste ainete asjad jäävad alles.</p>`}
  </section>`;
}

// Расписание обновляется само раз в сутки (если есть посредник).
function edupageAutoSync() {
  const src = state.source;
  if (src?.type === "edupage" && hasProxy() && Date.now() - (src.importedAt || 0) > 24 * 3600 * 1000) handleEdupageAction("edupage-refresh", { quiet: true });
}

async function handleEdupageAction(action, { quiet = false } = {}) {
  const rerender = () => onSettingsPage("schedule") && render();

  if (action === "edupage-cancel") {
    importDraft = null;
    return rerender();
  }

  if (action === "edupage-apply") {
    const d = importDraft;
    const r = applyEdupage(d.data, d.classId, d.chosen, d.url);
    importDraft = null;
    toast(`Tunniplaan laaditud: ${r.count} tundi nädalas`);
    return rerender();
  }

  const src = state.source;
  const url = action === "edupage-load" ? document.getElementById("ep-url")?.value || EDUPAGE_DEFAULT_URL : src.url;
  importDraft = { url, loading: true };
  rerender();
  try {
    const data = await edupageLoad(url);
    const same = src && src.school === data.school && data.tables.classes.some((c) => c.id === src.classId);
    if (action === "edupage-refresh" && same) {
      importDraft = null;
      const r = applyEdupage(data, src.classId, src.groups || {}, url);
      if (!quiet) toast(`Tunniplaan uuendatud: ${r.count} tundi nädalas`);
    } else {
      importDraft = { url, data, classId: same ? src.classId : "", chosen: same ? { ...(src.groups || {}) } : {} };
    }
  } catch (e) {
    console.warn("EduPage", e);
    importDraft = quiet ? null : { url, error: edupageErrorText(e) };
  }
  rerender();
}

function handleEdupageField(el) {
  if (!importDraft?.data) return;
  if (el.dataset.field === "ep-class") {
    importDraft.classId = el.value;
    importDraft.chosen = {};
  } else {
    if (el.value) importDraft.chosen[el.dataset.div] = el.value;
    else delete importDraft.chosen[el.dataset.div];
  }
  render();
}
