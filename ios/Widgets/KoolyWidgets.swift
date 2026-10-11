// Виджеты Kooly: таймер урока на экране блокировки и домашнем экране + Dynamic Island.
// Виджеты обновляются сами по расписанию: iOS заранее получает моменты начала и конца каждого урока.

import ActivityKit
import SwiftUI
import WidgetKit

private let brand = Color(red: 0, green: 0.31, blue: 0.36) // #004f5b
private let accent = Color(red: 1, green: 0.78, blue: 0.21) // #ffc836

@main
struct KoolyWidgetBundle: WidgetBundle {
    var body: some Widget {
        KoolyScheduleWidget()
        KoolyLiveActivityWidget()
    }
}

// MARK: - Таймер урока (экран блокировки и домашний экран)

struct ScheduleEntry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
    var demo: DemoLesson? = nil
}

struct ScheduleProvider: TimelineProvider {
    func placeholder(in context: Context) -> ScheduleEntry { ScheduleEntry(date: Date(), snapshot: nil) }

    func getSnapshot(in context: Context, completion: @escaping (ScheduleEntry) -> Void) {
        completion(ScheduleEntry(date: Date(), snapshot: KoolyShared.loadSnapshot()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ScheduleEntry>) -> Void) {
        let now = Date()
        let snapshot = KoolyShared.loadSnapshot()
        if let demo = KoolyShared.loadDemo() {
            // Пробный урок: показываем его, а после конца — обычное расписание.
            let entries = [ScheduleEntry(date: now, snapshot: snapshot, demo: demo), ScheduleEntry(date: demo.end, snapshot: snapshot)]
            completion(Timeline(entries: entries, policy: .after(demo.end.addingTimeInterval(60))))
            return
        }
        var dates = [now]
        if let snapshot { dates += Schedule.boundaries(from: now, days: 2, in: snapshot) }
        let entries = dates.prefix(60).map { ScheduleEntry(date: $0, snapshot: snapshot) }
        // Перезапросить расписание на следующий день после полуночи.
        let tomorrow = Schedule.calendar.startOfDay(for: now.addingTimeInterval(86_400)).addingTimeInterval(60)
        completion(Timeline(entries: Array(entries), policy: .after(min(tomorrow, entries.last?.date.addingTimeInterval(60) ?? tomorrow))))
    }
}

struct KoolyScheduleWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "KoolySchedule", provider: ScheduleProvider()) { entry in
            ScheduleWidgetView(entry: entry)
                .containerBackground(for: .widget) { Color(.systemBackground) }
        }
        .configurationDisplayName("Tunni taimer")
        .description("Mitu minutit tunni või vahetunni lõpuni.")
        .supportedFamilies([.accessoryRectangular, .accessoryCircular, .accessoryInline, .systemSmall])
    }
}

struct ScheduleWidgetView: View {
    let entry: ScheduleEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let demo = entry.demo, entry.date < demo.end {
            timerView(title: demo.title, detail: "ruum \(demo.room)", start: demo.start, end: demo.end, isLesson: true)
        } else if let snapshot = entry.snapshot {
            content(Schedule.status(at: entry.date, in: snapshot), snapshot)
        } else {
            Text("Ava Kooly").font(.caption)
        }
    }

    @ViewBuilder
    private func content(_ status: Status, _ snapshot: Snapshot) -> some View {
        switch status {
        case let .lesson(l, _):
            timerView(title: l.subject, detail: l.room.map { "ruum \($0)" } ?? "\(l.id). tund", start: l.start, end: l.end, isLesson: true)
        case let .breakTime(next, from):
            timerView(title: "Vahetund", detail: "→ \(next.subject)", start: from, end: next.start, isLesson: false)
        case let .before(first):
            plain(title: "Tunnid \(hhmm(first.start))", detail: first.subject, icon: "sunrise")
        case .after, .free:
            if let (day, lessons) = Schedule.nextSchoolDay(after: entry.date, in: snapshot) {
                let isTomorrow = Schedule.calendar.isDate(day, inSameDayAs: entry.date.addingTimeInterval(86_400))
                plain(title: "\(isTomorrow ? "Homme" : dayNames[Schedule.calendar.component(.weekday, from: day) - 1].capitalized) \(hhmm(lessons[0].start))",
                      detail: lessons[0].subject, icon: "backpack")
            } else {
                plain(title: "Tunde pole", detail: "", icon: "leaf")
            }
        }
    }

    @ViewBuilder
    private func timerView(title: String, detail: String, start: Date, end: Date, isLesson: Bool) -> some View {
        switch family {
        case .accessoryCircular:
            ProgressView(timerInterval: start...end, countsDown: true) {
                Image(systemName: isLesson ? "book" : "figure.walk")
            } currentValueLabel: {
                Text(timerInterval: start...end, countsDown: true).monospacedDigit().minimumScaleFactor(0.5)
            }
            .progressViewStyle(.circular)
        case .accessoryInline:
            Text("\(title) · \(Text(timerInterval: start...end, countsDown: true))")
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.headline).lineLimit(1)
                Text(timerInterval: start...end, countsDown: true).font(.title2.weight(.bold)).monospacedDigit()
                Text(detail).font(.caption2).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 4) {
                Text(isLesson ? "TUNNI LÕPUNI" : "TUNNI ALGUSENI").font(.caption2.weight(.heavy)).foregroundStyle(.secondary)
                Text(title).font(.headline).foregroundStyle(brand).lineLimit(2)
                Spacer(minLength: 0)
                Text(timerInterval: start...end, countsDown: true)
                    .font(.system(size: 34, weight: .heavy, design: .rounded)).monospacedDigit()
                    .foregroundStyle(isLesson ? brand : .primary)
                ProgressView(timerInterval: start...end, countsDown: false).tint(accent).labelsHidden()
                Text(detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func plain(title: String, detail: String, icon: String) -> some View {
        switch family {
        case .accessoryCircular:
            VStack(spacing: 0) {
                Image(systemName: icon)
                Text(title.split(separator: " ").last.map(String.init) ?? "").font(.caption2).monospacedDigit()
            }
        case .accessoryInline:
            Text("\(title) · \(detail)")
        default:
            VStack(alignment: .leading, spacing: 2) {
                Label(title, systemImage: icon).font(.headline).foregroundStyle(family == .systemSmall ? brand : .primary)
                if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Dynamic Island и экран блокировки

struct KoolyLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KoolyActivityAttributes.self) { context in
            LockScreenActivityView(state: context.state)
                .activityBackgroundTint(brand)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(s.title, systemImage: s.isLesson ? "book.fill" : "figure.walk")
                        .font(.headline).foregroundStyle(.white).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: s.start...s.end, countsDown: true)
                        .font(.title2.weight(.bold)).monospacedDigit().foregroundStyle(accent)
                        .multilineTextAlignment(.trailing).frame(maxWidth: 90)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(timerInterval: s.start...s.end, countsDown: false).tint(accent).labelsHidden()
                        Text(s.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            } compactLeading: {
                Image(systemName: s.isLesson ? "book.fill" : "figure.walk").foregroundStyle(accent)
            } compactTrailing: {
                Text(timerInterval: s.start...s.end, countsDown: true)
                    .monospacedDigit().foregroundStyle(accent)
                    .multilineTextAlignment(.trailing).frame(maxWidth: 48)
            } minimal: {
                Text(timerInterval: s.start...s.end, countsDown: true)
                    .monospacedDigit().font(.caption2).foregroundStyle(accent).frame(maxWidth: 40)
            }
        }
    }
}

struct LockScreenActivityView: View {
    let state: KoolyActivityAttributes.ContentState

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(state.isLesson ? "TUNNI LÕPUNI" : "VAHETUND").font(.caption2.weight(.heavy)).foregroundStyle(.white.opacity(0.7))
                Text(state.title).font(.headline).foregroundStyle(.white).lineLimit(1)
                Text(state.detail).font(.caption).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                ProgressView(timerInterval: state.start...state.end, countsDown: false).tint(accent).labelsHidden()
            }
            Text(timerInterval: state.start...state.end, countsDown: true)
                .font(.system(size: 36, weight: .heavy, design: .rounded)).monospacedDigit()
                .foregroundStyle(accent).multilineTextAlignment(.trailing).frame(width: 110, alignment: .trailing)
        }
        .padding(16)
    }
}
