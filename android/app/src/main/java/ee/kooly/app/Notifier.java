package ee.kooly.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Уведомления Kooly и таймер урока в шторке (аналог Dynamic Island на iPhone).
 * Веб-часть заранее считает уведомления на 3 дня вперёд (уроки, ранец, сроки) — здесь они ставятся будильниками
 * Android и приходят, даже когда Kooly закрыт. Таймер переключается будильником на каждой границе урока.
 */
final class Notifier {
    static final String CH_TIMER = "timer";
    static final String CH_REMINDERS = "reminders";
    static final String ACTION_SHOW = "ee.kooly.app.SHOW";
    static final String ACTION_TICK = "ee.kooly.app.TICK";
    private static final int TIMER_ID = 1;
    private static final int TEST_ID = 2;
    private static final int MAX_PLANNED = 60;

    private Notifier() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("kooly", Context.MODE_PRIVATE);
    }

    static JSONObject snapshot(Context c) {
        try {
            String s = prefs(c).getString("snapshot", null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    static void channels(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel timer = new NotificationChannel(CH_TIMER, "Tunni taimer", NotificationManager.IMPORTANCE_LOW);
        timer.setDescription("Mitu minutit tunni või vahetunni lõpuni");
        timer.setShowBadge(false);
        nm.createNotificationChannel(timer);
        NotificationChannel rem = new NotificationChannel(CH_REMINDERS, "Meeldetuletused", NotificationManager.IMPORTANCE_HIGH);
        rem.setDescription("Tunni algus, ranits ja tähtajad");
        nm.createNotificationChannel(rem);
    }

    private static PendingIntent openApp(Context c, String tab, int code) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (tab != null) i.putExtra("tab", tab);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void alarm(Context c, long at, PendingIntent pi) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
    }

    // MARK: Уведомления по расписанию

    static void schedule(Context c, JSONObject snapshot) {
        AlarmManager am = c.getSystemService(AlarmManager.class);
        SharedPreferences p = prefs(c);
        for (int i = 0; i < p.getInt("planned", 0); i++) am.cancel(planned(c, i, null));
        int count = 0;
        JSONArray list = snapshot == null ? null : snapshot.optJSONArray("notifications");
        if (snapshot != null && snapshot.optBoolean("notify") && list != null) {
            long now = System.currentTimeMillis();
            for (int i = 0; i < list.length() && count < MAX_PLANNED; i++) {
                JSONObject n = list.optJSONObject(i);
                if (n == null || n.optDouble("at", 0) <= now) continue;
                alarm(c, (long) n.optDouble("at"), planned(c, count++, n));
            }
        }
        p.edit().putInt("planned", count).apply();
    }

    private static PendingIntent planned(Context c, int index, JSONObject n) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_SHOW);
        if (n != null) {
            i.putExtra("title", n.optString("title"));
            i.putExtra("body", n.optString("body"));
            i.putExtra("tab", n.optString("tab", "now"));
            i.putExtra("id", n.optString("id").hashCode());
        }
        return PendingIntent.getBroadcast(c, 1000 + index, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void show(Context c, int id, String title, String body, String tab) {
        Notification n = new Notification.Builder(c, CH_REMINDERS)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(c.getColor(R.color.brand))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(openApp(c, tab, id))
                .setAutoCancel(true)
                .build();
        c.getSystemService(NotificationManager.class).notify(id, n);
    }

    /** «Testi teavitust»: пробное уведомление через 5 секунд — можно успеть закрыть Kooly. */
    static void test(Context c) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_SHOW)
                .putExtra("title", "Kooly test 🔔")
                .putExtra("body", "Nii näevad välja Kooly teavitused: tunni algus, ranits ja tähtajad.")
                .putExtra("tab", "now")
                .putExtra("id", TEST_ID);
        alarm(c, System.currentTimeMillis() + 5000,
                PendingIntent.getBroadcast(c, 900, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    }

    // MARK: Таймер урока

    /** «Testi taimerit»: пробный урок на несколько минут. */
    static void testTimer(Context c, double minutes) {
        long now = System.currentTimeMillis();
        prefs(c).edit().putLong("demoEnd", now + (long) (minutes * 60_000)).apply();
        updateTimer(c);
    }

    /** Показать текущий урок/перемену или убрать таймер; будильник — на следующую смену. */
    static void updateTimer(Context c) {
        long now = System.currentTimeMillis();
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        long demoEnd = prefs(c).getLong("demoEnd", 0);
        JSONObject snapshot = snapshot(c);

        Schedule.Timer t = null;
        if (demoEnd > now) t = new Schedule.Timer(true, "Proovitund", "Test · ruum 101 · siis Matemaatika", now - 60_000, demoEnd);
        else if (snapshot != null) t = Schedule.timer(snapshot, now);

        if (t == null) nm.cancel(TIMER_ID);
        else nm.notify(TIMER_ID, timerNotification(c, t, now));

        long next = -1;
        if (demoEnd > now) next = demoEnd;
        else if (snapshot != null) {
            List<Long> b = Schedule.boundaries(snapshot, now, 7);
            if (!b.isEmpty()) next = b.get(0);
        }
        PendingIntent tick = PendingIntent.getBroadcast(c, 1, new Intent(c, AlarmReceiver.class).setAction(ACTION_TICK),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (next > 0) alarm(c, next + 500, tick);
        else c.getSystemService(AlarmManager.class).cancel(tick);
    }

    private static Notification timerNotification(Context c, Schedule.Timer t, long now) {
        int total = (int) Math.max(1, (t.end - t.start) / 1000), done = (int) Math.min(total, Math.max(0, (now - t.start) / 1000));
        return new Notification.Builder(c, CH_TIMER)
                .setSmallIcon(R.drawable.ic_notify)
                .setColor(c.getColor(R.color.brand))
                .setContentTitle(t.title)
                .setContentText((t.isLesson ? "Tunni lõpuni · " : "Tunni alguseni · ") + t.detail)
                .setSubText(t.isLesson ? "Tund" : "Vahetund")
                .setWhen(t.end)
                .setShowWhen(true)
                .setUsesChronometer(true)
                .setChronometerCountDown(true) // обратный отсчёт до конца урока/перемены
                .setProgress(total, done, false)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_PROGRESS)
                .setVisibility(Notification.VISIBILITY_PUBLIC) // виден и на экране блокировки
                .setContentIntent(openApp(c, "now", TIMER_ID))
                .setTimeoutAfter(t.end - now + 60_000) // если будильник опоздает — не висеть с отрицательным временем
                .build();
    }
}
