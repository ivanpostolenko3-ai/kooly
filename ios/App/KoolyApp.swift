// Kooly для iPhone: веб-приложение Kooly (с сайта, обновляется само) + нативные возможности iOS:
// вход в Stuudium прямо в приложении, уведомления iOS, Dynamic Island и виджеты.

import BackgroundTasks
import SwiftUI
import UserNotifications

@main
struct KoolyApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var bridge = NativeBridge.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(bridge)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: bridge.appBecameActive()
            case .background: BackgroundRefresh.schedule()
            default: break
            }
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var bridge: NativeBridge

    var body: some View {
        ZStack {
            Color("LaunchBackground").ignoresSafeArea()
            KoolyWebView(bridge: bridge).ignoresSafeArea()
            // Невидимая страница Stuudium: через неё приложение забирает домашку и оценки.
            StuudiumFetcherView(fetcher: bridge.fetcher).frame(width: 1, height: 1).opacity(0.01).allowsHitTesting(false)
        }
        .sheet(isPresented: $bridge.showStuudiumLogin) {
            StuudiumLoginView(school: bridge.school) { bridge.stuudiumLoggedIn() }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        BackgroundRefresh.register()
        return true
    }

    // Уведомление пришло, пока Kooly открыт, — всё равно показать.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    // Нажали на уведомление — открыть нужную вкладку (например, «Homme» для ранца).
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let tab = response.notification.request.content.userInfo["tab"] as? String ?? "now"
        await MainActor.run { NativeBridge.shared.openTab(tab) }
    }
}
