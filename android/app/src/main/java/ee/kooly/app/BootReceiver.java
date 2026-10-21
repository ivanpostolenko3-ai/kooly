package ee.kooly.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** После перезагрузки телефона или обновления Kooly будильники стираются — ставим их заново. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        Notifier.channels(c);
        Notifier.schedule(c, Notifier.snapshot(c));
        Notifier.updateTimer(c);
    }
}
