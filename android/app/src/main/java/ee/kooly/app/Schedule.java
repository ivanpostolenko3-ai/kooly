package ee.kooly.app;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Расписание из снимка, который присылает веб-часть (shareState() в app.js).
 * Логика та же, что в ios/Shared/KoolyShared.swift: на уроке — до перемены, на перемене — до урока,
 * до первого и после последнего урока таймера нет.
 */
final class Schedule {
    static final TimeZone ZONE = TimeZone.getTimeZone("Europe/Tallinn");

    static final class Lesson {
        final int n; // номер урока
        final String subject;
        final String room;
        final long start, end;

        Lesson(int n, String subject, String room, long start, long end) {
            this.n = n;
            this.subject = subject;
            this.room = room;
            this.start = start;
            this.end = end;
        }
    }

    /** Что показывать в таймере сейчас: урок или перемена (null — таймера нет). */
    static final class Timer {
        final boolean isLesson;
        final String title, detail;
        final long start, end;

        Timer(boolean isLesson, String title, String detail, long start, long end) {
            this.isLesson = isLesson;
            this.title = title;
            this.detail = detail;
            this.start = start;
            this.end = end;
        }
    }

    private Schedule() {}

    private static Calendar day(long time) {
        Calendar c = Calendar.getInstance(ZONE);
        c.setTimeInMillis(time);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c;
    }

    private static long at(Calendar day, String hhmm) {
        String[] p = hhmm.split(":");
        if (p.length != 2) return -1;
        try {
            Calendar c = (Calendar) day.clone();
            c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(p[0].trim()));
            c.set(Calendar.MINUTE, Integer.parseInt(p[1].trim()));
            return c.getTimeInMillis();
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    static List<Lesson> lessons(JSONObject s, long dayTime) {
        List<Lesson> out = new ArrayList<>();
        Calendar day = day(dayTime);
        int jsDay = day.get(Calendar.DAY_OF_WEEK) - 1; // 0 = pühapäev, как в JS
        if (jsDay == 0 || jsDay > s.optInt("schoolDays", 5)) return out;
        JSONObject timetable = s.optJSONObject("timetable");
        JSONArray row = timetable == null ? null : timetable.optJSONArray(String.valueOf(jsDay));
        JSONArray bells = s.optJSONArray("bells");
        if (row == null || bells == null) return out;

        Map<String, String> names = new HashMap<>();
        JSONArray subjects = s.optJSONArray("subjects");
        for (int i = 0; subjects != null && i < subjects.length(); i++) {
            JSONObject o = subjects.optJSONObject(i);
            if (o != null && !names.containsKey(o.optString("id"))) names.put(o.optString("id"), o.optString("name"));
        }

        for (int i = 0; i < row.length() && i < bells.length(); i++) {
            Object cell = row.opt(i);
            String id = null, room = null;
            if (cell instanceof String) id = (String) cell;
            else if (cell instanceof JSONObject) {
                id = ((JSONObject) cell).optString("s", null);
                room = ((JSONObject) cell).optString("room", null);
                if (room != null && room.isEmpty()) room = null;
            }
            String name = id == null ? null : names.get(id);
            JSONObject bell = bells.optJSONObject(i);
            if (name == null || bell == null) continue;
            long start = at(day, bell.optString("start")), end = at(day, bell.optString("end"));
            if (start < 0 || end < 0) continue;
            out.add(new Lesson(i + 1, name, room, start, end));
        }
        return out;
    }

    static Timer timer(JSONObject s, long now) {
        List<Lesson> today = lessons(s, now);
        for (int i = 0; i < today.size(); i++) {
            Lesson l = today.get(i);
            if (now >= l.start && now < l.end) {
                String detail = l.room != null ? "ruum " + l.room : l.n + ". tund";
                if (i + 1 < today.size()) detail += " · siis " + today.get(i + 1).subject;
                return new Timer(true, l.subject, detail, l.start, l.end);
            }
            if (l.start > now) {
                if (i == 0) return null; // до первого урока таймера нет
                Lesson next = l;
                String detail = "→ " + next.subject + (next.room != null ? " · ruum " + next.room : "");
                return new Timer(false, "Vahetund", detail, today.get(i - 1).end, next.start);
            }
        }
        return null; // уроки кончились
    }

    /** Ближайшие моменты, когда меняется состояние таймера (начало и конец уроков). */
    static List<Long> boundaries(JSONObject s, long now, int days) {
        List<Long> out = new ArrayList<>();
        for (int i = 0; i <= days; i++) {
            for (Lesson l : lessons(s, now + i * 86_400_000L)) {
                if (l.start > now) out.add(l.start);
                if (l.end > now) out.add(l.end);
            }
        }
        Collections.sort(out);
        return out;
    }
}
