// Dynamic Island, уведомления iOS и фоновые обновления.

import ActivityKit
import BackgroundTasks
import UserNotifications
import WidgetKit

// MARK: - Dynamic Island / экран блокировки (Live Activity)

@MainActor
final class LiveActivityManager {
    static let shared = LiveActivityManager()
    private var timer: Timer?

    /// Показать текущий урок/перемену; до первого и после последнего урока — убрать.
    func update(_ snapshot: Snapshot?) {
        timer?.invalidate()
        guard let snapshot, ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let now = Date()
        let state = KoolyActivityAttributes.ContentState.make(at: now, from: snapshot)
        let current = Activity<KoolyActivityAttributes>.activities

        Task {
            if let state {
                // staleDate: если iOS не разбудит приложение вовремя, отметка «устарело» появится после конца урока/перемены.
                let content = ActivityContent(state: state, staleDate: state.end.addingTimeInterval(60))
                if let activity = current.first {
                    await activity.update(content)
                    for extra in current.dropFirst() { await extra.end(nil, dismissalPolicy: .immediate) }
                } else {
                    _ = try? Activity.request(attributes: KoolyActivityAttributes(), content: content, pushType: nil)
                }
            } else {
                for activity in current { await activity.end(nil, dismissalPolicy: .immediate) }
            }
        }

        // Пока Kooly открыт — переключаемся точно на границе урока и перемены.
        if let next = Schedule.boundaries(from: now, days: 0, in: snapshot).first {
            timer = Timer.scheduledTimer(withTimeInterval: next.timeIntervalSince(now) + 1, repeats: false) { _ in
                Task { @MainActor in LiveActivityManager.shared.update(KoolyShared.loadSnapshot()) }
            }
        }
    }
}

#if DEBUG
extension LiveActivityManager {
    /// Только для проверки в симуляторе (аргумент запуска -koolyDemoActivity): урок «Inglise keel», 35 минут до перемены.
    func demo() {
        let now = Date()
        let state = KoolyActivityAttributes.ContentState(isLesson: true, title: "Inglise keel", detail: "2. tund · ruum 304 · siis Eesti keel",
                                                         start: now.addingTimeInterval(-35 * 60), end: now.addingTimeInterval(35 * 60))
        Task {
            for a in Activity<KoolyActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            _ = try? Activity.request(attributes: KoolyActivityAttributes(), content: ActivityContent(state: state, staleDate: nil), pushType: nil)
        }
    }
}
#endif

// MARK: - Уведомления iOS (приходят и при закрытом Kooly)

enum NotificationScheduler {
    /// Веб-часть заранее считает уведомления на 3 дня вперёд (уроки, ранец, сроки заданий) — ставим их в iOS.
    static func schedule(_ snapshot: Snapshot) {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        guard snapshot.notify == true, let list = snapshot.notifications else { return }
        let now = Date()
        for n in list.prefix(60) {
            let date = Date(timeIntervalSince1970: n.at / 1000)
            guard date > now else { continue }
            let content = UNMutableNotificationContent()
            content.title = n.title
            content.body = n.body
            content.sound = .default
            content.userInfo = ["tab": n.tab ?? "now"]
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            center.add(UNNotificationRequest(identifier: n.id, content: content,
                                             trigger: UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)))
        }
    }
}

// MARK: - Фоновое обновление: iOS будит Kooly около границ уроков, чтобы переключить Dynamic Island

enum BackgroundRefresh {
    static let identifier = "ee.kooly.refresh"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            schedule()
            Task { @MainActor in
                LiveActivityManager.shared.update(KoolyShared.loadSnapshot())
                WidgetCenter.shared.reloadAllTimelines()
                task.setTaskCompleted(success: true)
            }
        }
    }

    /// Просим разбудить к следующей смене урока/перемены (iOS решает сама, точное время не гарантировано).
    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        if let snapshot = KoolyShared.loadSnapshot(), let next = Schedule.boundaries(from: Date(), days: 1, in: snapshot).first {
            request.earliestBeginDate = next
        } else {
            request.earliestBeginDate = Date().addingTimeInterval(60 * 60)
        }
        try? BGTaskScheduler.shared.submit(request)
    }
}
