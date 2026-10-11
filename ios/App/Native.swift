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
    private var testUntil = Date.distantPast

    /// «Testi taimerit»: пробный урок на несколько минут — Dynamic Island, экран блокировки и виджет.
    func test(minutes: Double) {
        timer?.invalidate()
        let now = Date()
        let end = now.addingTimeInterval(minutes * 60)
        testUntil = end
        KoolyShared.saveDemo(DemoLesson(title: "Proovitund", room: "101", start: now.addingTimeInterval(-60), end: end))
        WidgetCenter.shared.reloadAllTimelines()
        let state = KoolyActivityAttributes.ContentState(isLesson: true, title: "Proovitund", detail: "Test · ruum 101 · siis Matemaatika",
                                                         start: now.addingTimeInterval(-60), end: end)
        Task {
            for a in Activity<KoolyActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
            _ = try? Activity.request(attributes: KoolyActivityAttributes(), content: ActivityContent(state: state, staleDate: end), pushType: nil)
        }
        // Когда пробный урок кончится — вернуть обычное расписание.
        timer = Timer.scheduledTimer(withTimeInterval: minutes * 60 + 2, repeats: false) { _ in
            Task { @MainActor in
                WidgetCenter.shared.reloadAllTimelines()
                LiveActivityManager.shared.update(KoolyShared.loadSnapshot())
            }
        }
    }

    /// Показать текущий урок/перемену; до первого и после последнего урока — убрать.
    func update(_ snapshot: Snapshot?) {
        if Date() < testUntil { return } // идёт пробный урок — не мешаем
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

// MARK: - Уведомления iOS (приходят и при закрытом Kooly)

enum NotificationScheduler {
    /// «Testi teavitust»: пробное уведомление через 5 секунд (если нужно — сначала спросить разрешение).
    static func test() {
        let center = UNUserNotificationCenter.current()
        Task {
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            let content = UNMutableNotificationContent()
            content.title = "Kooly test 🔔"
            content.body = "Nii näevad välja Kooly teavitused: tunni algus, ranits ja tähtajad."
            content.sound = .default
            content.userInfo = ["tab": "now"]
            try? await center.add(UNNotificationRequest(identifier: "kooly-test-\(Date().timeIntervalSince1970)", content: content,
                                                        trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)))
        }
    }

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
