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
                .opacity(bridge.webReady ? 1 : 0)
            if !bridge.webReady {
                SplashView(offline: bridge.offline) { bridge.loadSite() }
                    .transition(.opacity)
            }
            // Невидимая страница Stuudium: через неё приложение забирает домашку и оценки.
            StuudiumFetcherView(fetcher: bridge.fetcher).frame(width: 1, height: 1).opacity(0.01).allowsHitTesting(false)
        }
        .sheet(isPresented: $bridge.showStuudiumLogin) {
            StuudiumLoginView(school: bridge.school) { bridge.stuudiumLoggedIn() }
        }
    }
}

/// Заставка, пока Kooly загружается, и экран «нет связи» — вместо белого экрана.
struct SplashView: View {
    let offline: Bool
    let retry: () -> Void
    @State private var showSpinner = false

    var body: some View {
        VStack(spacing: 18) {
            // Тот же значок, что на экране запуска iOS, — переход без мигания.
            Image("LaunchLogo").resizable().frame(width: 200, height: 200)
            if offline {
                Text("Ühendus puudub. Kontrolli internetti.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button(action: retry) {
                    Text("Proovi uuesti").font(.headline).padding(.horizontal, 22).padding(.vertical, 12)
                        .background(Color(red: 0, green: 0.31, blue: 0.36), in: Capsule()).foregroundStyle(.white)
                }
            } else if showSpinner {
                ProgressView().tint(Color(red: 0, green: 0.31, blue: 0.36))
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("LaunchBackground"))
        .task {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            showSpinner = true
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
