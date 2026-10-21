package ee.kooly.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import org.json.JSONObject;

/**
 * Kooly для Android: сайт Kooly внутри приложения (новые версии приходят сами, без переустановки APK)
 * плюс то, чего нет у сайта: уведомления при закрытом Kooly, таймер урока в шторке, вход в Stuudium и Google.
 *
 * Мост — те же сообщения, что у приложения для iPhone (ios/App/NativeBridge.swift):
 *   веб → приложение: window.KoolyAndroid.post(JSON { type, … })
 *   приложение → веб: koolyNativeStuudium(raw, quiet), koolyNativeGoogleToken(id, result), switchTab(tab), koolyBack()
 */
public class MainActivity extends Activity {
    static final String SITE = "https://ivanpostolenko3-ai.github.io/kooly/";
    private static final String SITE_HOST = Uri.parse(SITE).getHost();
    private static final int REQ_MIC = 1, REQ_NOTIFY = 2, REQ_FILE = 3, REQ_SAVE = 4, REQ_STUUDIUM = 5;

    private final Handler main = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View offlineView;
    private StuudiumFetcher fetcher;
    private GoogleAuth google;

    private boolean ready, triedCache;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> pendingFiles;
    private String pendingSave, pendingSaveMime;
    private String school = "narvaeesti";
    private boolean notifyAfterPermission;

    private SharedPreferences prefs() {
        return Notifier.prefs(this);
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Notifier.channels(this);
        google = new GoogleAuth(this);
        school = prefs().getString("school", "narvaeesti");

        root = new FrameLayout(this);
        root.setBackgroundResource(R.drawable.splash); // заставка, пока Kooly не нарисовался
        applyInsets();

        fetcher = new StuudiumFetcher(this);
        fetcher.script = prefs().getString("stuudiumScript", null);
        root.addView(fetcher.webView, new FrameLayout.LayoutParams(1, 1)); // невидимая страница Stuudium
        fetcher.webView.setAlpha(0.01f);

        web = createWebView();
        web.setVisibility(View.INVISIBLE);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        offlineView = createOfflineView();
        root.addView(offlineView);
        setContentView(root);

        loadSite(false); // данные Kooly в localStorage, так что страницу всегда грузим заново
        handleIntent(getIntent());
    }

    // MARK: Окно: отступы под строку состояния, жесты и клавиатуру (Android 15 рисует приложение на весь экран)

    private void applyInsets() {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom, left, right;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                top = bars.top;
                bottom = Math.max(bars.bottom, ime.bottom);
                left = bars.left;
                right = bars.right;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
                right = insets.getSystemWindowInsetRight();
            }
            v.setPadding(left, top, right, bottom);
            return insets;
        });
    }

    /** Цвет под строкой состояния = фон страницы Kooly; тёмные или светлые значки — по яркости фона. */
    private void matchPageColor() {
        web.evaluateJavascript("getComputedStyle(document.body).backgroundColor", r -> {
            if (r == null) return;
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+),\\s*(\\d+),\\s*(\\d+)").matcher(r);
            if (!m.find()) return;
            int red = Integer.parseInt(m.group(1)), green = Integer.parseInt(m.group(2)), blue = Integer.parseInt(m.group(3));
            root.setBackgroundColor(Color.rgb(red, green, blue));
            boolean light = (red * 299 + green * 587 + blue * 114) / 1000 > 140;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController c = getWindow().getInsetsController();
                if (c != null) {
                    int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    c.setSystemBarsAppearance(light ? mask : 0, mask);
                }
            } else {
                int flags = getWindow().getDecorView().getSystemUiVisibility();
                flags = light ? flags | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                getWindow().getDecorView().setSystemUiVisibility(flags);
            }
        });
    }

    // MARK: Страница Kooly

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private WebView createWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // данные Kooly (localStorage) сохраняются между запусками
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Ощущение приложения, а не сайта: без зума и без «резинки».
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        w.setOverScrollMode(View.OVER_SCROLL_NEVER);
        w.setBackgroundColor(Color.TRANSPARENT);
        CookieManager.getInstance().setAcceptCookie(true);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);

        w.addJavascriptInterface(new Bridge(), "KoolyAndroid");
        w.setWebViewClient(new WebViewClient() {
            // Ссылки на другие сайты (Opiq, Stuudium, PDF меню…) — в браузере телефона.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (SITE_HOST.equals(url.getHost()) || "about".equals(url.getScheme()) || "blob".equals(url.getScheme()) || "data".equals(url.getScheme())) return false;
                openExternal(url);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // Страница загрузилась: если Kooly уже нарисовался — убираем заставку (на случай версии сайта без «ready»).
                main.postDelayed(() -> web.evaluateJavascript(
                        "document.getElementById('view') ? document.getElementById('view').childElementCount : 0",
                        r -> {
                            if (r != null && !r.equals("0") && !r.equals("null")) markReady();
                        }), 1500);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) loadFailed();
            }
        });
        w.setWebChromeClient(new WebChromeClient() {
            // Микрофон для ИИ-диктовки — только странице Kooly (Android сам спросит разрешение в первый раз).
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                main.post(() -> {
                    boolean ours = SITE_HOST.equals(request.getOrigin().getHost());
                    boolean audio = false;
                    for (String r : request.getResources()) audio |= PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r);
                    if (!ours || !audio) {
                        request.deny();
                    } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        pendingMic = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                    }
                });
            }

            // Выбор файла (восстановление копии данных Kooly).
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                    startActivityForResult(pick, REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });
        return w;
    }

    private View createOfflineView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL | Gravity.BOTTOM);
        int dp = (int) getResources().getDisplayMetrics().density;
        box.setPadding(32 * dp, 0, 32 * dp, 0);
        TextView text = new TextView(this);
        text.setText("Ühendus puudub. Kontrolli internetti.");
        text.setGravity(Gravity.CENTER);
        text.setTextColor(getColor(R.color.link));
        box.addView(text);
        Button retry = new Button(this);
        retry.setText("Proovi uuesti");
        retry.setAllCaps(false);
        retry.setOnClickListener(v -> loadSite(false));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = 16 * dp;
        box.addView(retry, lp);
        // Под логотипом заставки (он по центру экрана, 200dp).
        FrameLayout.LayoutParams flp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        flp.topMargin = 280 * dp;
        box.setLayoutParams(flp);
        box.setVisibility(View.GONE);
        return box;
    }

    /** Загрузить Kooly с сайта (свежая версия). Если сайт не ответит — сохранённая копия, иначе «Ühendus puudub». */
    private void loadSite(boolean fromCache) {
        ready = false;
        triedCache = fromCache;
        offlineView.setVisibility(View.GONE);
        web.getSettings().setCacheMode(fromCache ? WebSettings.LOAD_CACHE_ELSE_NETWORK : WebSettings.LOAD_DEFAULT);
        web.loadUrl(SITE);
        main.postDelayed(() -> {
            if (!ready) loadFailed();
        }, 20_000);
    }

    private void loadFailed() {
        if (ready) return;
        if (!triedCache) loadSite(true);
        else offlineView.setVisibility(View.VISIBLE);
    }

    private void markReady() {
        if (ready) return;
        ready = true;
        offlineView.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        matchPageColor();
    }

    private void js(String code) {
        web.evaluateJavascript(code, null);
    }

    private void openExternal(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Linki ei õnnestunud avada", Toast.LENGTH_SHORT).show();
        }
    }

    // MARK: Сообщения из веб-части

    private final class Bridge {
        @JavascriptInterface
        public void post(String json) {
            main.post(() -> {
                try {
                    handle(new JSONObject(json));
                } catch (Exception ignored) {
                    // битое сообщение — пропускаем
                }
            });
        }
    }

    private void handle(JSONObject m) {
        switch (m.optString("type")) {
            case "state": {
                JSONObject snapshot = m.optJSONObject("snapshot");
                if (snapshot == null) return;
                prefs().edit().putString("snapshot", snapshot.toString()).apply();
                Notifier.schedule(this, snapshot);
                Notifier.updateTimer(this);
                matchPageColor(); // могли сменить тему
                break;
            }
            case "notify-permission":
                notifyAfterPermission = false;
                askNotifications();
                break;
            case "test-notification":
                notifyAfterPermission = true;
                if (askNotifications()) {
                    notifyAfterPermission = false;
                    Notifier.test(this);
                }
                break;
            case "test-timer":
                askNotifications();
                Notifier.testTimer(this, m.optDouble("minutes", 2));
                break;
            case "stuudium-script":
                saveScript(m);
                break;
            case "stuudium-login":
                saveScript(m);
                setSchool(m.optString("school"));
                startActivityForResult(new Intent(this, StuudiumLoginActivity.class).putExtra("school", school), REQ_STUUDIUM);
                break;
            case "stuudium-sync":
                saveScript(m);
                setSchool(m.optString("school"));
                syncStuudium(false);
                break;
            case "gcal-token": {
                String id = m.optString("id");
                google.token(this, m.optBoolean("interactive"), (token, expiresIn, error) -> {
                    JSONObject result = new JSONObject();
                    try {
                        if (error != null) result.put("error", error);
                        else result.put("token", token).put("expiresIn", expiresIn);
                    } catch (Exception ignored) {
                        // не бывает
                    }
                    js("window.koolyNativeGoogleToken && window.koolyNativeGoogleToken(" + JSONObject.quote(id) + ", " + result + ")");
                });
                break;
            }
            case "gcal-signout":
                google.signOut();
                break;
            case "save-file":
                saveFile(m.optString("name", "kooly.txt"), m.optString("mime", "text/plain"), m.optString("text"));
                break;
            case "ready":
                markReady();
                break;
            default:
                break;
        }
    }

    /** Код сбора домашки и оценок приходит с сайта (STUUDIUM_FETCH_JS в connect.js) — исправления без переустановки. */
    private void saveScript(JSONObject m) {
        String script = m.optString("script", "");
        if (script.isEmpty()) return;
        fetcher.script = script;
        prefs().edit().putString("stuudiumScript", script).apply();
    }

    private void setSchool(String s) {
        if (s == null || !s.matches("[a-z0-9-]+")) return;
        school = s;
        prefs().edit().putString("school", s).apply();
    }

    /** true — разрешение на уведомления уже есть. Иначе Android спросит (Android 13+). */
    private boolean askNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return true;
        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFY);
        return false;
    }

    // MARK: Stuudium

    private void syncStuudium(boolean quiet) {
        fetcher.fetch(school, raw -> {
            if (raw.startsWith("KOOLY-ERR:login")) prefs().edit().putBoolean("stuudiumConnected", false).apply();
            else if (!raw.startsWith("KOOLY-ERR:")) prefs().edit().putLong("stuudiumLastSync", System.currentTimeMillis()).apply();
            js("window.koolyNativeStuudium && window.koolyNativeStuudium(" + JSONObject.quote(raw) + ", " + quiet + ")");
        });
    }

    // MARK: Сохранение файла (копия данных, .ics) — Android спросит, куда сохранить

    private void saveFile(String name, String mime, String text) {
        pendingSave = text;
        pendingSaveMime = mime;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mime.split(";")[0]).putExtra(Intent.EXTRA_TITLE, name);
        try {
            startActivityForResult(i, REQ_SAVE);
        } catch (ActivityNotFoundException e) {
            pendingSave = null;
            Toast.makeText(this, "Faili ei õnnestunud salvestada", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == REQ_FILE) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            if (pendingFiles != null) pendingFiles.onReceiveValue(uri == null ? null : new Uri[]{uri});
            pendingFiles = null;
        } else if (request == REQ_SAVE) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            if (uri != null && pendingSave != null) {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    out.write(pendingSave.getBytes(StandardCharsets.UTF_8));
                    Toast.makeText(this, "Salvestatud", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Faili ei õnnestunud salvestada", Toast.LENGTH_SHORT).show();
                }
            }
            pendingSave = null;
        } else if (request == REQ_STUUDIUM && result == RESULT_OK) {
            prefs().edit().putBoolean("stuudiumConnected", true).apply();
            syncStuudium(false);
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (request == REQ_MIC && pendingMic != null) {
            if (granted) pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingMic.deny();
            pendingMic = null;
        } else if (request == REQ_NOTIFY) {
            if (granted) {
                Notifier.schedule(this, Notifier.snapshot(this));
                Notifier.updateTimer(this);
                if (notifyAfterPermission) Notifier.test(this);
            } else {
                Toast.makeText(this, "Teavitused on keelatud — luba need Androidi seadetes", Toast.LENGTH_LONG).show();
            }
            notifyAfterPermission = false;
        }
    }

    // MARK: Жизненный цикл

    @Override
    protected void onResume() {
        super.onResume();
        google.appResumed();
        Notifier.updateTimer(this);
        if (ready) {
            // Android мог выгрузить страницу из памяти — тогда загрузить заново.
            web.evaluateJavascript("document.getElementById('view') ? document.getElementById('view').childElementCount : 0", r -> {
                if (r == null || r.equals("0") || r.equals("null")) loadSite(false);
            });
        }
        // Давно не обновлялись — тихо забрать домашку и оценки (веб-части даём загрузиться).
        if (prefs().getBoolean("stuudiumConnected", false)
                && System.currentTimeMillis() - prefs().getLong("stuudiumLastSync", 0) > 30 * 60_000L) {
            main.postDelayed(() -> syncStuudium(true), 3000);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        if (google.handleRedirect(intent.getData())) return;
        String tab = intent.getStringExtra("tab");
        if (tab != null) {
            String safe = tab.matches("now|tomorrow|tasks|calendar|progress") ? tab : "now";
            main.postDelayed(() -> js("typeof switchTab === 'function' && switchTab('" + safe + "')"), ready ? 0 : 1500);
            intent.removeExtra("tab");
        }
    }

    // Кнопка/жест «Назад»: закрыть предмет или настройки, вернуться на «Praegu», и только потом выйти.
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("typeof koolyBack === 'function' && koolyBack()", r -> {
            if (!"true".equals(r)) moveTaskToBack(true);
        });
    }
}
