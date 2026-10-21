package ee.kooly.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Вход в Stuudium: ученик сам входит на странице Stuudium (пароль, Smart-ID или ID-карта) — пароль Kooly не видит.
 * Как только вход удался, окно закрывается само.
 */
public class StuudiumLoginActivity extends Activity {
    private boolean done;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        String school = getIntent().getStringExtra("school");
        if (school == null || !school.matches("[a-z0-9-]+")) school = "narvaeesti";

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(getColor(R.color.background));
        root.setFitsSystemWindows(true);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        int pad = (int) (12 * getResources().getDisplayMetrics().density);
        bar.setPadding(pad, pad / 2, pad, pad / 2);
        TextView hint = new TextView(this);
        hint.setText("Logi sisse nagu tavaliselt ja märgi „Jäta mind meelde“. Kooly sulgeb akna ise.");
        hint.setTextSize(13);
        bar.addView(hint, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button cancel = new Button(this, null, android.R.attr.borderlessButtonStyle);
        cancel.setText("Loobu");
        cancel.setTextColor(getColor(R.color.link));
        cancel.setOnClickListener(v -> finish());
        bar.addView(cancel);
        root.addView(bar);

        WebView web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        web.setWebViewClient(new WebViewClient() {
            // Вход удался: мы на *.ope.ee, не на странице входа и формы входа нет.
            @Override
            public void onPageFinished(WebView view, String url) {
                Uri u = url == null ? null : Uri.parse(url);
                if (done || u == null || u.getHost() == null || !u.getHost().endsWith(".ope.ee") || u.getPath() == null || u.getPath().startsWith("/auth")) return;
                view.evaluateJavascript("!!document.querySelector('#main_login_form')", r -> {
                    if (done || !"false".equals(r)) return;
                    done = true;
                    CookieManager.getInstance().flush();
                    setResult(RESULT_OK);
                    finish();
                });
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        web.loadUrl("https://" + school + ".ope.ee/auth/");
    }
}
