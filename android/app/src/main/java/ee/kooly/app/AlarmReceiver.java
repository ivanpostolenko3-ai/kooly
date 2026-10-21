package ee.kooly.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Будильники Kooly: показать запланированное уведомление или переключить таймер урока. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        Notifier.channels(c);
        if (Notifier.ACTION_SHOW.equals(intent.getAction())) {
            Notifier.show(c, intent.getIntExtra("id", 3), intent.getStringExtra("title"), intent.getStringExtra("body"), intent.getStringExtra("tab"));
        } else if (Notifier.ACTION_TICK.equals(intent.getAction())) {
            Notifier.updateTimer(c);
        }
    }
}
