package ee.kooly.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.LinkedHashMap;
import java.util.Map;

import org.json.JSONObject;

/**
 * Вход в Google Календарь. Google не пускает вход во встроенных окнах (WebView), поэтому вход идёт в браузере
 * телефона (OAuth 2.0 с PKCE, без секрета в приложении), а Google возвращает в Kooly по адресу com.googleusercontent.apps…
 * Долгоживущий ключ (refresh token) хранится в данных приложения — заново входить не нужно.
 * Ключ клиента тот же, что у приложения для iPhone (ios/App/GoogleAuth.swift).
 */
final class GoogleAuth {
    interface Callback {
        void done(String token, int expiresIn, String error); // error: need-login, popup_closed, access_denied, network
    }

    static final String CLIENT_ID = "810943360481-n6o6utir2h1nl2614cvcfno1fp1augi5.apps.googleusercontent.com";
    static final String SCHEME = "com.googleusercontent.apps.810943360481-n6o6utir2h1nl2614cvcfno1fp1augi5";
    static final String REDIRECT = SCHEME + ":/oauthredirect";
    static final String SCOPES = "https://www.googleapis.com/auth/calendar.events "
            + "https://www.googleapis.com/auth/calendar.calendarlist.readonly "
            + "https://www.googleapis.com/auth/calendar.app.created";

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String accessToken;
    private long expiry;
    // Идёт вход в браузере
    private Callback pending;
    private String verifier, state;
    private long startedAt;

    GoogleAuth(Context context) {
        this.context = context.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences("google", Context.MODE_PRIVATE);
    }

    void token(Activity activity, boolean interactive, Callback cb) {
        if (accessToken != null && expiry > System.currentTimeMillis() + 60_000) {
            cb.done(accessToken, (int) ((expiry - System.currentTimeMillis()) / 1000), null);
            return;
        }
        String refresh = prefs().getString("refresh", null);
        if (refresh != null) {
            Map<String, String> p = new LinkedHashMap<>();
            p.put("refresh_token", refresh);
            p.put("client_id", CLIENT_ID);
            p.put("grant_type", "refresh_token");
            post(p, (json, error) -> {
                if ("revoked".equals(error)) {
                    prefs().edit().remove("refresh").apply(); // доступ отозвали в Google — нужен новый вход
                    if (interactive) signIn(activity, cb);
                    else cb.done(null, 0, "need-login");
                } else if (error != null) cb.done(null, 0, error);
                else store(json, cb);
            });
            return;
        }
        if (!interactive) cb.done(null, 0, "need-login");
        else signIn(activity, cb);
    }

    void signOut() {
        String refresh = prefs().getString("refresh", null);
        if (refresh != null) {
            Map<String, String> p = new LinkedHashMap<>();
            p.put("token", refresh);
            new Thread(() -> request("https://oauth2.googleapis.com/revoke", p)).start();
        }
        prefs().edit().remove("refresh").apply();
        accessToken = null;
        expiry = 0;
    }

    private void signIn(Activity activity, Callback cb) {
        if (pending != null) pending.done(null, 0, "popup_closed");
        verifier = random(48);
        state = random(12);
        pending = cb;
        startedAt = System.currentTimeMillis();
        String challenge;
        try {
            challenge = b64(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        } catch (Exception e) {
            finish(null, 0, "access_denied");
            return;
        }
        Uri url = Uri.parse("https://accounts.google.com/o/oauth2/v2/auth").buildUpon()
                .appendQueryParameter("client_id", CLIENT_ID)
                .appendQueryParameter("redirect_uri", REDIRECT)
                .appendQueryParameter("response_type", "code")
                .appendQueryParameter("scope", SCOPES)
                .appendQueryParameter("code_challenge", challenge)
                .appendQueryParameter("code_challenge_method", "S256")
                .appendQueryParameter("access_type", "offline")
                .appendQueryParameter("prompt", "consent")
                .appendQueryParameter("state", state)
                .build();
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (Exception e) {
            finish(null, 0, "access_denied");
        }
    }

    /** Google вернул в Kooly (MainActivity.onNewIntent). true — это наш ответ. */
    boolean handleRedirect(Uri uri) {
        if (uri == null || !SCHEME.equals(uri.getScheme())) return false;
        if (pending == null) return true;
        String code = uri.getQueryParameter("code");
        if (uri.getQueryParameter("error") != null || code == null || !state.equals(uri.getQueryParameter("state"))) {
            finish(null, 0, "access_denied");
            return true;
        }
        Map<String, String> p = new LinkedHashMap<>();
        p.put("code", code);
        p.put("client_id", CLIENT_ID);
        p.put("code_verifier", verifier);
        p.put("redirect_uri", REDIRECT);
        p.put("grant_type", "authorization_code");
        Callback cb = pending;
        pending = null;
        post(p, (json, error) -> {
            if (error != null) {
                cb.done(null, 0, error);
                return;
            }
            String refresh = json.optString("refresh_token", null);
            if (refresh != null) prefs().edit().putString("refresh", refresh).apply();
            store(json, cb);
        });
        return true;
    }

    /** Вернулись в Kooly без ответа Google (закрыли браузер) — вход отменён. */
    void appResumed() {
        if (pending == null || System.currentTimeMillis() - startedAt < 1500) return;
        main.postDelayed(() -> {
            if (pending != null) finish(null, 0, "popup_closed");
        }, 1500);
    }

    private void finish(String token, int expiresIn, String error) {
        Callback cb = pending;
        pending = null;
        if (cb != null) cb.done(token, expiresIn, error);
    }

    private void store(JSONObject json, Callback cb) {
        String token = json.optString("access_token", null);
        if (token == null) {
            cb.done(null, 0, "access_denied");
            return;
        }
        int expiresIn = json.optInt("expires_in", 3600);
        accessToken = token;
        expiry = System.currentTimeMillis() + expiresIn * 1000L;
        cb.done(token, expiresIn, null);
    }

    // MARK: Сеть

    private interface JsonCallback {
        void done(JSONObject json, String error);
    }

    private void post(Map<String, String> params, JsonCallback cb) {
        new Thread(() -> {
            String body = request("https://oauth2.googleapis.com/token", params);
            JSONObject json = null;
            String error = null;
            if (body == null) error = "network";
            else {
                try {
                    json = new JSONObject(body);
                    if ("invalid_grant".equals(json.optString("error"))) error = "revoked";
                } catch (Exception e) {
                    error = "network";
                }
            }
            JSONObject result = json;
            String err = error;
            main.post(() -> cb.done(result, err));
        }).start();
    }

    private static String request(String url, Map<String, String> params) {
        try {
            StringBuilder form = new StringBuilder();
            for (Map.Entry<String, String> e : params.entrySet()) {
                if (form.length() > 0) form.append('&');
                form.append(e.getKey()).append('=').append(URLEncoder.encode(e.getValue(), "UTF-8"));
            }
            HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(15000);
            con.setReadTimeout(15000);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            try (OutputStream out = con.getOutputStream()) {
                out.write(form.toString().getBytes(StandardCharsets.UTF_8));
            }
            InputStream in = con.getResponseCode() < 400 ? con.getInputStream() : con.getErrorStream();
            if (in == null) return "{}";
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[4096];
            for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
            in.close();
            return buf.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    private static String random(int bytes) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        return b64(b);
    }

    private static String b64(byte[] b) {
        return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }
}
