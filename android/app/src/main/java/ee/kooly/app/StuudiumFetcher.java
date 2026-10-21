package ee.kooly.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Невидимая страница на домене Stuudium: выполняет тот же код, что ярлык iOS и приложение для iPhone
 * (ios/App/Stuudium.swift), и возвращает JSON с домашкой и оценками или KOOLY-ERR:код.
 * Вход хранится в куки WebView (CookieManager), общих с окном входа StuudiumLoginActivity.
 */
final class StuudiumFetcher {
    interface Callback {
        void done(String raw);
    }

    // Запасной код, пока сайт не прислал свежий STUUDIUM_FETCH_JS (connect.js): тело async-функции с return.
    private static final String SCRIPT =
            "if (!/\\.ope\\.ee$/.test(location.hostname)) return \"KOOLY-ERR:not-stuudium\";\n"
            + "const base = location.origin;\n"
            + "const get = async (u) => new DOMParser().parseFromString(await (await fetch(u, { credentials: \"include\" })).text(), \"text/html\");\n"
            + "const home = await get(base + \"/\");\n"
            + "if (home.querySelector(\"#main_login_form\")) return \"KOOLY-ERR:login\";\n"
            + "const todos = [...home.querySelectorAll(\".todo_container\")].map((e) => ({ html: e.outerHTML, marked: !!e.closest(\".is_marked\") }));\n"
            + "const a = [...home.querySelectorAll(\"a[href]\")].find((x) => /^hinded$/i.test(x.textContent.trim()) || /\\/grades\\/student\\//.test(x.getAttribute(\"href\")));\n"
            + "let grades = null;\n"
            + "if (a) {\n"
            + "  const g = await get(new URL(a.getAttribute(\"href\"), base));\n"
            + "  const t = g.querySelector(\"table.student_lessons_grades\");\n"
            + "  const p = [...g.querySelectorAll(\"h3\")].map((x) => x.textContent.trim()).find((x) => /\\d+\\.\\d+\\s*[—–-]/.test(x));\n"
            + "  grades = { html: t ? t.innerHTML : \"\", period: p || \"\" };\n"
            + "}\n"
            + "return JSON.stringify({ kooly: \"stuudium/1\", school: location.hostname.split(\".\")[0], at: Date.now(), todos, grades });\n";

    final WebView webView;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Callback pending;
    String script; // свежий код с сайта (MainActivity сохраняет его в настройках)
    private boolean injected;
    private int run; // номер загрузки: таймаут старой не должен оборвать новую

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    StuudiumFetcher(Context context) {
        webView = new WebView(context);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void result(String raw) {
                main.post(() -> finish(raw));
            }
        }, "KoolyFetch");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (pending == null || injected || url == null || !url.contains(".ope.ee/")) return;
                injected = true;
                view.evaluateJavascript("(async () => {\n" + (script != null ? script : SCRIPT) + "\n})()"
                        + ".catch((e) => \"KOOLY-ERR:\" + (e && e.message || e))"
                        + ".then((r) => KoolyFetch.result(String(r)));", null);
            }
        });
    }

    void fetch(String school, Callback cb) {
        if (pending != null) {
            cb.done("KOOLY-ERR:busy");
            return;
        }
        if (school == null || !school.matches("[a-z0-9-]+")) {
            cb.done("KOOLY-ERR:school");
            return;
        }
        pending = cb;
        injected = false;
        int current = ++run;
        // Лёгкая страница на домене Stuudium: нужна только «прописка» на нём, остальное делает fetch() со своими куки.
        webView.loadUrl("https://" + school + ".ope.ee/robots.txt");
        main.postDelayed(() -> {
            if (run == current) finish("KOOLY-ERR:timeout");
        }, 45_000);
    }

    private void finish(String raw) {
        Callback cb = pending;
        pending = null;
        if (cb != null) cb.done(raw == null ? "KOOLY-ERR:empty" : raw);
    }
}
