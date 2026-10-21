#!/usr/bin/env python3
"""Локальный сервер Kooly.

1. Отдаёт файлы приложения.
2. Пересылает запросы к публичному расписанию EduPage
   (браузер не может обратиться к edupage.org напрямую — сайт не разрешает CORS):
       POST /api/edupage/<школа>/<regulartt|ttviewer>/<функция>
   и отдаёт HTML страниц сайта школы для меню столовой (разбирает приложение):
       GET  /api/page?url=<адрес>
3. Забирает домашние задания из Stuudium через сохранённую сессию Chrome:
       POST /api/stuudium/login     — открыть окно Chrome, чтобы ученик сам вошёл в Stuudium
       POST /api/stuudium/status    — вошёл ли ученик в открытом окне (Kooly опрашивает сам)
       POST /api/stuudium/homework  — прочитать список заданий (в открытом окне или в фоновом Chrome)
       POST /api/stuudium/logout    — удалить сохранённую сессию
   Пароль Kooly не видит и не хранит: вход делает сам ученик, у Stuudium есть защита от ботов (Cloudflare Turnstile),
   которую мы не обходим. Stuudium-запросы принимаются только с этого компьютера (localhost).
"""

import base64
import datetime
import hashlib
import html.parser
import http.server
import json
import os
import re
import shutil
import signal
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
STUUDIUM_PROFILE = os.path.join(ROOT, ".stuudium-profile")
STUUDIUM_DEBUG = os.path.join(ROOT, ".stuudium-debug.html")
STUUDIUM_COOKIES = os.path.join(STUUDIUM_PROFILE, "kooly-session.json")
# Копии страниц Stuudium (только на этом Mac) — по ним настраивается разбор заданий и оценок.
STUUDIUM_SAMPLE = os.path.join(ROOT, ".stuudium-sample.html")
STUUDIUM_GRADES_SAMPLE = os.path.join(ROOT, ".stuudium-grades.html")
# Снимок данных Kooly для таймера в строке меню Mac (mac/KoolyMenu): расписание, звонки, задачи.
KOOLY_STATE = os.path.join(ROOT, ".kooly-state.json")

# Пересылаем только эти запросы, чтобы сервер не стал открытым прокси.
EDUPAGE_PATH = re.compile(r"^/api/edupage/([a-z0-9-]{2,63})/(regulartt|ttviewer)/([A-Za-z]{1,40})$")
EDUPAGE_FUNCS = {"regularttGetData", "getTTViewerData"}
SCHOOL_NAME = re.compile(r"^[a-z0-9-]{2,63}$")

CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    os.path.expanduser("~/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]
# Один и тот же «ключ» для куки в обычном и фоновом режиме, иначе headless-Chrome не прочитает сессию.
CHROME_FLAGS = ["--use-mock-keychain", "--no-first-run", "--no-default-browser-check", f"--user-data-dir={STUUDIUM_PROFILE}"]


def find_chrome():
    return next((p for p in CHROME_PATHS if os.path.exists(p)), None)


class DevTools:
    """Минимальный клиент Chrome DevTools Protocol поверх WebSocket (только стандартная библиотека)."""

    def __init__(self, ws_url):
        host_port, path = ws_url[len("ws://"):].split("/", 1)
        host, port = host_port.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (f"GET /{path} HTTP/1.1\r\nHost: {host_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
             f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode()
        )
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("devtools handshake")
            response += chunk
        self.buffer = response.split(b"\r\n\r\n", 1)[1]
        self.next_id = 0

    def _recv_exact(self, n):
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("devtools closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def _recv_message(self):
        message = b""
        while True:
            b1, b2 = self._recv_exact(2)
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._recv_exact(8))[0]
            message += self._recv_exact(length)
            if b1 & 0x80:  # последний фрагмент
                return message.decode("utf-8", "replace")

    def call(self, method, **params):
        self.next_id += 1
        payload = json.dumps({"id": self.next_id, "method": method, "params": params}).encode()
        mask = os.urandom(4)
        header = bytes([0x81])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))
        while True:
            msg = json.loads(self._recv_message())
            if msg.get("id") == self.next_id:
                return msg.get("result", {})

    def evaluate(self, expression):
        result = self.call("Runtime.evaluate", expression=expression, returnByValue=True)
        return result.get("result", {}).get("value")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def page_targets(port):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
        return [t for t in json.load(r) if t.get("type") == "page"]


def close_browser(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2) as r:
            DevTools(json.load(r)["webSocketDebuggerUrl"]).call("Browser.close")
    except Exception:
        pass


# Страница загружена: видно задания, форму входа или прошло 12 секунд.
PAGE_READY = (
    "document.readyState === 'complete' && "
    "(!!document.querySelector('.todo_container, #main_login_form') || performance.now() > 12000)"
)
# Ученик уже вошёл: мы на *.ope.ee, но не на странице входа.
LOGGED_IN = (
    "location.hostname.endsWith('.ope.ee') && !location.pathname.startsWith('/auth') && "
    "document.readyState === 'complete' && !document.querySelector('#main_login_form')"
)


def read_page(tools, url, wait=25):
    """Открывает url во вкладке и возвращает HTML после загрузки."""
    tools.call("Page.navigate", url=url)
    deadline = time.time() + wait
    time.sleep(1.5)
    while time.time() < deadline:
        if tools.evaluate(PAGE_READY):
            break
        time.sleep(0.5)
    time.sleep(0.5)
    return tools.evaluate("document.documentElement.outerHTML") or ""


def load_cookies():
    try:
        with open(STUUDIUM_COOKIES, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def save_cookies(tools):
    """Сохраняем куки Stuudium: без этого «короткая» сессия пропадает, когда Chrome закрывается."""
    cookies = tools.call("Network.getAllCookies").get("cookies", [])
    keep = [
        {k: c[k] for k in ("name", "value", "domain", "path", "secure", "httpOnly", "sameSite", "expires") if k in c}
        for c in cookies
        if c.get("domain", "").endswith(("ope.ee", "stuudium.com", "stuudium.net"))
    ]
    if not keep:
        return
    with open(STUUDIUM_COOKIES, "w", encoding="utf-8") as f:
        json.dump(keep, f)
    os.chmod(STUUDIUM_COOKIES, 0o600)


def restore_cookies(tools):
    cookies = []
    for c in load_cookies():
        c = dict(c)
        if c.get("expires", -1) in (-1, 0):
            c.pop("expires", None)  # сессионная кука
        if c.get("sameSite") not in ("Strict", "Lax", "None"):
            c.pop("sameSite", None)
        cookies.append(c)
    if cookies:
        tools.call("Network.setCookies", cookies=cookies)


class StuudiumSession:
    """Вкладка с сессией Stuudium: в открытом окне входа или в фоновом (невидимом) Chrome."""

    def __init__(self, chrome):
        self.proc = None
        self.port = window_port()
        self.window = bool(self.port)
        if self.window:
            tab = stuudium_tab(self.port) or new_tab(self.port)
        else:
            stop_profile_chrome()
            self.port = free_port()
            self.proc = subprocess.Popen(
                [chrome, "--headless=new", "--disable-gpu", *CHROME_FLAGS, f"--remote-debugging-port={self.port}", "about:blank"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            tab = None
            for _ in range(60):
                try:
                    targets = page_targets(self.port)
                    if targets:
                        tab = targets[0]
                        break
                except OSError:
                    pass
                time.sleep(0.25)
            if not tab:
                self.close(False)
                raise RuntimeError("chrome-start")
        self.tools = DevTools(tab["webSocketDebuggerUrl"])
        if not self.window:
            restore_cookies(self.tools)

    def read(self, url):
        return read_page(self.tools, url)

    def close(self, logged_in):
        if logged_in:
            try:
                save_cookies(self.tools)
            except Exception as e:
                sys.stderr.write(f"stuudium cookies: {e!r}\n")
        # Окно входа закрываем, только когда вход удался; фоновый Chrome — всегда.
        if logged_in or not self.window:
            close_browser(self.port)
        if self.proc:
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()


def profile_pid():
    """PID главного процесса Chrome с профилем Stuudium (на Mac он живёт и после закрытия окна).
    Ищем по командной строке: файл SingletonLock бывает удалён, хотя Chrome ещё работает."""
    marker = f"--user-data-dir={STUUDIUM_PROFILE}"
    try:
        out = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    for line in out.splitlines():
        pid_text, _, command = line.strip().partition(" ")
        if marker in command and "--type=" not in command:
            pid = int(pid_text)
            try:
                # Если Chrome запускал этот сервер и он уже завершился — забираем «зомби», иначе он выглядит живым.
                if os.waitpid(pid, os.WNOHANG)[0] == pid:
                    continue
            except ChildProcessError:
                pass
            return pid
    return None


def window_port():
    """DevTools-порт открытого окна входа (Chrome пишет его в DevToolsActivePort при --remote-debugging-port=0)."""
    if not profile_pid():
        return None
    try:
        with open(os.path.join(STUUDIUM_PROFILE, "DevToolsActivePort")) as f:
            port = int(f.readline().strip())
        page_targets(port)
        return port
    except (OSError, ValueError):
        return None


def stop_profile_chrome():
    """Закрывает Chrome с профилем Stuudium (только наш отдельный профиль, не обычный Chrome пользователя)."""
    pid = profile_pid()
    if not pid:
        return
    port = window_port()
    if port:
        close_browser(port)
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    for i in range(60):
        if not profile_pid():
            return
        if i == 20:  # не закрылся за 5 секунд — закрываем принудительно
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                return
        time.sleep(0.25)


def stuudium_tab(port):
    targets = page_targets(port)
    return next((t for t in targets if ".ope.ee" in t.get("url", "")), targets[0] if targets else None)


def new_tab(port, url="about:blank"):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?{url}", method="PUT")
    with urllib.request.urlopen(req, timeout=3) as r:
        return json.load(r)


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []
        self.classes = set((self.attrs.get("class") or "").split())

    def text(self):
        parts = []
        for c in self.children:
            parts.append(c if isinstance(c, str) else c.text())
        return re.sub(r"\s+", " ", "".join(parts)).strip()

    def find_all(self, pred):
        for c in self.children:
            if isinstance(c, Node):
                if pred(c):
                    yield c
                yield from c.find_all(pred)


class TreeBuilder(html.parser.HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root", [], None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in self.VOID:
            self.cur = node

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


BLOCK_TAGS = {"br", "p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "tr"}


def lines_of(node):
    """Текст узла с переносами строк там, где в HTML были <br>, абзацы и т. п."""
    out = []

    def walk(n):
        for c in n.children:
            if isinstance(c, str):
                out.append(c)
            else:
                if c.tag in BLOCK_TAGS:
                    out.append("\n")
                walk(c)
                if c.tag in BLOCK_TAGS:
                    out.append("\n")

    walk(node)
    text = "".join(out).replace("\xa0", " ")
    return [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n") if line.strip()]


def parse_stuudium_todos(page):
    """Задания на главной странице ученика: div.todo_container[data-date=ГГГГММДД] > a.subject_name + span.todo_content."""
    builder = TreeBuilder()
    builder.feed(page)
    tasks = []
    for box in builder.root.find_all(lambda n: "todo_container" in n.classes):
        subject = next(box.find_all(lambda n: "subject_name" in n.classes), None)
        content = next(box.find_all(lambda n: "todo_content" in n.classes), None)
        if not content:
            continue
        raw_date = re.sub(r"\D", "", box.attrs.get("data-date") or "")
        date = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:8]}" if len(raw_date) == 8 else None
        done = False
        n = box
        while n is not None:
            if "is_marked" in n.classes:
                done = True
                break
            n = n.parent
        subject_name = subject.text() if subject else ""
        # Тип задания (Kontrolltöö, Kodutöö…) — бейдж рядом с заданием.
        badge = next(box.find_all(lambda n: any("badge" in c or c.endswith("_type") for c in n.classes)), None)
        kind = badge.text() if badge else ""
        lines = [l for l in lines_of(content) if l != kind]
        title_node = next(box.find_all(lambda n: any("title" in c for c in n.classes)), None)
        title = title_node.text() if title_node else (lines[0] if lines else "")
        description = "\n".join(l for l in lines if l != title)
        links = [
            {"text": a.text() or a.attrs.get("href"), "href": a.attrs.get("href")}
            for a in content.find_all(lambda n: n.tag == "a" and (n.attrs.get("href") or "").startswith("http"))
        ]
        text = " ".join(lines)
        uid = box.attrs.get("data-todo-id") or box.attrs.get("data-id") or hashlib.sha1(f"{date}|{subject_name}|{text}".encode()).hexdigest()[:16]
        tasks.append({
            "id": uid, "date": date, "subject": subject_name, "title": title, "description": description,
            "kind": kind, "links": links, "text": text, "done": done,
        })
    return tasks


GRADE_VALUE = re.compile(r"^grade_([A-Z0-9]+)$")


def parse_stuudium_grades(page):
    """Страница «Minu hinded»: строка на предмет (th > a[href*=/subjects/]), ячейка на урок (td.lesson_ГГГГММДД).
    Оценка: span.grade > span.grade_active.grade_95 (значение) + span.grade_notes (за что) + data-note (комментарий).
    Столбец td.lesson_final — итоговая оценка за ступень («Kooliastme»), у пройденных курсов по выбору там «AR»."""
    builder = TreeBuilder()
    builder.feed(page)
    period = next((h.text() for h in builder.root.find_all(lambda n: n.tag == "h3") if re.search(r"\d+\.\d+\s*[—–-]", h.text())), "")
    subjects, courses = [], []
    for tr in builder.root.find_all(lambda n: n.tag == "tr"):
        th = next((c for c in tr.children if isinstance(c, Node) and c.tag == "th"), None)
        tds = [c for c in tr.children if isinstance(c, Node) and c.tag == "td"]
        if not th or not tds:
            continue  # шапка таблицы или закреплённая колонка с одними названиями
        link = next(th.find_all(lambda n: n.tag == "a" and "/subjects/" in (n.attrs.get("href") or "")), None)
        final_td = next((c for c in tds if "lesson_final" in c.classes), None)
        final = final_td.text().replace("\xa0", "").strip() if final_td else ""
        if not link:
            if th.text() and final:
                courses.append({"name": th.text(), "final": final})
            continue
        subject = {"name": link.text(), "final": final, "grades": []}
        for td in tds:
            day = next((c[7:] for c in td.classes if re.fullmatch(r"lesson_\d{8}", c)), None)
            if not day:
                continue
            topic_node = next(td.find_all(lambda n: "lesson_notes" in n.classes), None)
            topic = topic_node.text()[:200] if topic_node else ""
            for grade in td.find_all(lambda n: "grade" in n.classes):
                value_node = next(grade.find_all(lambda n: any(GRADE_VALUE.match(c) for c in n.classes)), None)
                if not value_node:
                    continue
                value = re.sub(r"^(\d+)\s*%$", r"\1", value_node.text())  # Stuudium пишет «95%» — храним «95»
                note = next(grade.find_all(lambda n: "grade_notes" in n.classes), None)
                comment = next(grade.find_all(lambda n: "grade_param_has_comment" in n.classes), None)
                subject["grades"].append({
                    "date": f"{day[:4]}-{day[4:6]}-{day[6:8]}",
                    "value": value,
                    "numeric": int(value) if value.isdigit() else None,
                    "active": "grade_active" in value_node.classes,
                    "note": note.text() if note else "",
                    "comment": (comment.attrs.get("data-note") or "").strip() if comment else "",
                    "topic": topic,
                })
        subject["grades"].sort(key=lambda g: g["date"])
        subjects.append(subject)
    return {"period": period, "subjects": subjects, "courses": courses}


def find_grades_url(page, base):
    """Ссылка на страницу оценок в меню Stuudium («Hinded»)."""
    builder = TreeBuilder()
    builder.feed(page)
    for a in builder.root.find_all(lambda n: n.tag == "a" and n.attrs.get("href")):
        label = a.text().lower()
        href = a.attrs["href"]
        if label in ("hinded", "hinded ja hinnangud") or re.search(r"/(hinded|grades)\b", href):
            return href if href.startswith("http") else base.rstrip("/") + "/" + href.lstrip("/")
    return None


def find_prev_grades_url(page, base):
    """«eelmine» — предыдущая часть таблицы оценок. Stuudium показывает по умолчанию только текущую часть,
    поэтому идём назад до начала учебного года («eelmine aasta» — прошлый год — пропускаем)."""
    builder = TreeBuilder()
    builder.feed(page)
    for a in builder.root.find_all(lambda n: n.tag == "a" and "period_prev" in n.classes and n.attrs.get("href")):
        href = a.attrs["href"]
        if "year_move" in href:
            return None
        return href if href.startswith("http") else base.rstrip("/") + "/" + href.lstrip("/")
    return None


def merge_grade_pages(pages):
    """Части таблицы оценок → как у веб-части (parseStuudiumGradePages): текущий период + вся история."""
    current = pages[0]

    def merged(sets):
        by_subject = {}
        for st in sets:
            for s in st["subjects"]:
                m = by_subject.setdefault(s["name"], {"name": s["name"], "final": "", "grades": [], "keys": set()})
                if not m["final"] and s["final"]:
                    m["final"] = s["final"]
                for g in s["grades"]:
                    key = (g["date"], g["value"], g["note"], g["comment"])
                    if key not in m["keys"]:
                        m["keys"].add(key)
                        m["grades"].append(g)
        out = []
        for m in by_subject.values():
            m.pop("keys")
            m["grades"].sort(key=lambda g: g["date"])
            out.append(m)
        return out

    return {
        "period": current["period"],
        "subjects": merged([p for p in pages if p["period"] == current["period"]]),
        "courses": current["courses"],
        "history": merged(pages),
    }


# ---------- Страницы сайта школы (меню столовой) ----------

def fetch_text(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Kooly)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(3_000_000).decode("utf-8", "replace"), r.geturl()


def safe_site_url(raw):
    """Только обычные публичные сайты по https/http — без localhost и IP (сервер не должен ходить во внутреннюю сеть)."""
    raw = raw.strip()
    url = raw if re.match(r"^https?://", raw, re.I) else "https://" + raw
    host = urllib.parse.urlparse(url).hostname or ""
    if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", host, re.I) or re.fullmatch(r"[\d.]+", host) or host.endswith(".local"):
        return None
    return url


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---------- статика ----------

    def send_head(self):
        # Не отдаём служебные файлы: профиль Chrome с сессией Stuudium, логи, сам сервер.
        path = self.path.split("?", 1)[0]
        if "/." in path or path.endswith(".py") or path.endswith(".command"):
            self.send_error(404)
            return None
        return super().send_head()

    def do_GET(self):
        if self.path == "/api/ping":
            return self.json(200, {"ok": True})
        if self.path.startswith("/api/page?"):
            return self.school_page()
        return super().do_GET()

    def end_headers(self):
        # Во время разработки браузер не должен держать старые версии файлов.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # ---------- API ----------

    def do_POST(self):
        limit = 2_000_000 if self.path == "/api/state" else 10_000
        length = min(int(self.headers.get("Content-Length") or 0), limit)
        body = self.rfile.read(length)

        if self.path == "/api/state":
            return self.save_state(body)

        match = EDUPAGE_PATH.match(self.path)
        if match and match.group(3) in EDUPAGE_FUNCS:
            return self.edupage(*match.groups(), body)

        if self.path.startswith("/api/stuudium/"):
            if self.client_address[0] not in ("127.0.0.1", "::1"):
                return self.json(403, {"error": "local-only"})
            try:
                school = json.loads(body or b"{}").get("school", "")
            except ValueError:
                school = ""
            action = self.path.rsplit("/", 1)[1]
            if action == "logout":
                stop_profile_chrome()
                shutil.rmtree(STUUDIUM_PROFILE, ignore_errors=True)
                for path in (STUUDIUM_DEBUG, STUUDIUM_SAMPLE, STUUDIUM_GRADES_SAMPLE):
                    if os.path.exists(path):
                        os.remove(path)
                return self.json(200, {"ok": True})
            if action == "status":
                return self.stuudium_status()
            if not SCHOOL_NAME.match(school):
                return self.json(400, {"error": "school"})
            if action == "login":
                return self.stuudium_login(school)
            if action == "homework":
                return self.stuudium_homework(school)

        self.send_error(404)

    def json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def edupage(self, school, file, func, body):
        url = f"https://{school}.edupage.org/timetable/server/{file}.js?__func={func}"
        request = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json; charset=UTF-8", "User-Agent": "Kooly/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                payload, status = response.read(), response.status
        except urllib.error.HTTPError as e:
            payload, status = e.read(), e.code
        except Exception as e:  # нет интернета, неверное имя школы и т. п.
            payload, status = json.dumps({"error": type(e).__name__}).encode(), 502
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def save_state(self, body):
        """Kooly в браузере присылает свои данные — их читает таймер в строке меню Mac. Только с этого компьютера."""
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return self.json(403, {"error": "local-only"})
        try:
            json.loads(body)
        except ValueError:
            return self.json(400, {"error": "json"})
        tmp = KOOLY_STATE + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        os.chmod(tmp, 0o600)
        os.replace(tmp, KOOLY_STATE)
        return self.json(200, {"ok": True})

    def school_page(self):
        """HTML страницы сайта школы — разбирает его само приложение (как через облачный Worker)."""
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        site = safe_site_url((query.get("url") or [""])[0])
        if not site:
            return self.json(403, {"error": "site"})
        try:
            text, final_url = fetch_text(site)
        except Exception as e:
            sys.stderr.write(f"page: {e!r}\n")
            return self.json(502, {"error": "network"})
        payload = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Final-Url", final_url)
        self.end_headers()
        self.wfile.write(payload)

    def stuudium_login(self, school):
        chrome = find_chrome()
        if not chrome:
            return self.json(500, {"error": "no-chrome"})
        url = f"https://{school}.ope.ee/auth/"
        port = window_port()
        if port:
            # Окно (или фоновый процесс после закрытия окна) уже есть — открываем Stuudium в нём заново.
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?{url}", method="PUT")
                urllib.request.urlopen(req, timeout=3).close()
                return self.json(200, {"ok": True})
            except OSError:
                pass
        stop_profile_chrome()  # старый процесс без DevTools — закрываем и открываем заново
        subprocess.Popen(
            [chrome, *CHROME_FLAGS, "--remote-debugging-port=0", "--new-window", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return self.json(200, {"ok": True})

    def stuudium_status(self):
        """Вошёл ли ученик в открытом окне? Kooly спрашивает каждые несколько секунд."""
        port = window_port()
        if not port:
            return self.json(200, {"window": False, "loggedIn": False})
        try:
            tab = stuudium_tab(port)
            logged_in = bool(tab and DevTools(tab["webSocketDebuggerUrl"]).evaluate(LOGGED_IN))
        except Exception:
            logged_in = False
        return self.json(200, {"window": True, "loggedIn": logged_in})

    def stuudium_homework(self, school):
        chrome = find_chrome()
        if not chrome:
            return self.json(500, {"error": "no-chrome"})
        if not os.path.isdir(STUUDIUM_PROFILE):
            return self.json(401, {"error": "login"})
        base = f"https://{school}.ope.ee/"
        session = None
        logged_in = False
        try:
            session = StuudiumSession(chrome)
            page = session.read(base)
            logged_in = bool(page.strip()) and 'id="main_login_form"' not in page and 'data-role="login-form"' not in page
            grades_pages = []
            if logged_in:
                with open(STUUDIUM_SAMPLE, "w", encoding="utf-8") as f:
                    f.write(page)
                grades_url = find_grades_url(page, base)
                seen = set()
                while grades_url and len(grades_pages) < 8 and grades_url not in seen:
                    seen.add(grades_url)
                    grades_page = session.read(grades_url)
                    if not grades_pages:
                        with open(STUUDIUM_GRADES_SAMPLE, "w", encoding="utf-8") as f:
                            f.write(grades_page)
                    grades_pages.append(grades_page)
                    grades_url = find_prev_grades_url(grades_page, base)
        except Exception as e:
            sys.stderr.write(f"stuudium: {e!r}\n")
            return self.json(502, {"error": "chrome"})
        finally:
            if session:
                session.close(logged_in)
        if not page.strip():
            return self.json(502, {"error": "empty"})
        if not logged_in:
            return self.json(401, {"error": "login"})
        tasks = parse_stuudium_todos(page)
        grades = merge_grade_pages([parse_stuudium_grades(p) for p in grades_pages]) if grades_pages else None
        result = {"tasks": tasks, "grades": grades}
        if not tasks:
            result["warning"] = "no-todos"
        return self.json(200, result)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("", PORT), Handler)
    print(f"Kooly: http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
