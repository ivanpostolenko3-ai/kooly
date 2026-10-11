// Мост между веб-частью Kooly и iOS.
// Веб → приложение: window.webkit.messageHandlers.kooly.postMessage({ type, … })
//   state             — снимок расписания/задач/уведомлений → виджеты, Dynamic Island, уведомления iOS
//   notify-permission — спросить разрешение на уведомления
//   stuudium-login    — открыть вход в Stuudium
//   stuudium-sync     — забрать домашку и оценки
// Приложение → веб: window.koolyNativeStuudium(raw, quiet), switchTab(tab)

import SwiftUI
import UserNotifications
import WebKit
import WidgetKit

@MainActor
final class NativeBridge: NSObject, ObservableObject, WKScriptMessageHandler {
    static let shared = NativeBridge()

    @Published var showStuudiumLogin = false
    @Published private(set) var school = UserDefaults.standard.string(forKey: "stuudiumSchool") ?? "narvaeesti"

    weak var webView: WKWebView?
    let fetcher = StuudiumFetcher()

    private var stuudiumConnected: Bool {
        get { UserDefaults.standard.bool(forKey: "stuudiumConnected") }
        set { UserDefaults.standard.set(newValue, forKey: "stuudiumConnected") }
    }

    private var lastStuudiumSync: Date {
        get { Date(timeIntervalSince1970: UserDefaults.standard.double(forKey: "stuudiumLastSync")) }
        set { UserDefaults.standard.set(newValue.timeIntervalSince1970, forKey: "stuudiumLastSync") }
    }

    // MARK: Сообщения из веб-части

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "state":
            guard let snapshot = body["snapshot"], let data = try? JSONSerialization.data(withJSONObject: snapshot) else { return }
            KoolyShared.saveSnapshot(data)
            WidgetCenter.shared.reloadAllTimelines()
            let parsed = KoolyShared.loadSnapshot()
            LiveActivityManager.shared.update(parsed)
            if let parsed { NotificationScheduler.schedule(parsed) }
        case "notify-permission":
            Task {
                let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
                if granted, let s = KoolyShared.loadSnapshot() { NotificationScheduler.schedule(s) }
            }
        case "stuudium-login":
            if let s = body["school"] as? String, !s.isEmpty { setSchool(s) }
            showStuudiumLogin = true
        case "test-timer":
            let minutes = (body["minutes"] as? Double) ?? 2
            LiveActivityManager.shared.test(minutes: minutes)
        case "test-notification":
            NotificationScheduler.test()
        case "log":
            NSLog("KoolyWeb: %@", body["msg"] as? String ?? "")
        case "stuudium-sync":
            if let s = body["school"] as? String, !s.isEmpty { setSchool(s) }
            syncStuudium(quiet: false)
        default:
            break
        }
    }

    private func setSchool(_ s: String) {
        school = s
        UserDefaults.standard.set(s, forKey: "stuudiumSchool")
    }

    // MARK: Stuudium

    func stuudiumLoggedIn() {
        showStuudiumLogin = false
        stuudiumConnected = true
        syncStuudium(quiet: false)
    }

    func syncStuudium(quiet: Bool) {
        Task {
            let raw = await fetcher.fetch(school: school)
            if raw.hasPrefix("KOOLY-ERR:login") { stuudiumConnected = false }
            else if !raw.hasPrefix("KOOLY-ERR:") { lastStuudiumSync = Date() }
            send(raw: raw, quiet: quiet)
        }
    }

    private func send(raw: String, quiet: Bool) {
        webView?.callAsyncJavaScript("window.koolyNativeStuudium && window.koolyNativeStuudium(raw, quiet)",
                                     arguments: ["raw": raw, "quiet": quiet], in: nil, in: .page) { _ in }
    }

    // MARK: Жизненный цикл

    /// Открыли Kooly: обновить Dynamic Island и, если давно не обновлялись, домашку из Stuudium.
    func appBecameActive() {
        LiveActivityManager.shared.update(KoolyShared.loadSnapshot())
        if stuudiumConnected, Date().timeIntervalSince(lastStuudiumSync) > 30 * 60 {
            // Даём веб-части загрузиться, потом тихо обновляем.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.syncStuudium(quiet: true) }
        }
    }

    func openTab(_ tab: String) {
        let safe = ["now", "tomorrow", "tasks", "calendar", "progress"].contains(tab) ? tab : "now"
        webView?.evaluateJavaScript("typeof switchTab === 'function' && switchTab('\(safe)')")
    }
}
