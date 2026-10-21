// Stuudium внутри приложения.
// Вход: ученик сам входит на странице Stuudium (пароль, Smart-ID или ID-карта) — пароль Kooly не видит.
// Сессия хранится в WKWebsiteDataStore.default(), общем для окна входа и невидимой страницы ниже.
// Загрузка: невидимая страница на домене Stuudium выполняет тот же код, что и ярлык iOS (connect.js →
// STUUDIUM_SHORTCUT_JS), и возвращает JSON с домашкой и оценками или KOOLY-ERR:код.

import SwiftUI
import WebKit

@MainActor
final class StuudiumFetcher: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    private var loaded: CheckedContinuation<Void, Never>?
    private var busy = false

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: config)
        super.init()
        webView.navigationDelegate = self
    }

    func fetch(school: String) async -> String {
        guard !busy else { return "KOOLY-ERR:busy" }
        busy = true
        defer { busy = false }
        // Лёгкая страница на домене Stuudium: нужна только «прописка» на нём, остальное делает fetch() со своими куки.
        guard let url = URL(string: "https://\(school).ope.ee/robots.txt") else { return "KOOLY-ERR:school" }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            loaded = c
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
            DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in self?.finishLoading() }
        }
        do {
            let script = UserDefaults.standard.string(forKey: "stuudiumScript") ?? Self.script // свежий код с сайта, если уже пришёл
            let result = try await webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .defaultClient)
            return result as? String ?? "KOOLY-ERR:empty"
        } catch {
            return "KOOLY-ERR:\(error.localizedDescription)"
        }
    }

    private func finishLoading() {
        loaded?.resume()
        loaded = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finishLoading() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finishLoading() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { finishLoading() }

    /// Запасной вариант, пока сайт не прислал свежий STUUDIUM_FETCH_JS (connect.js).
    static let script = """
    if (!/\\.ope\\.ee$/.test(location.hostname)) return "KOOLY-ERR:not-stuudium";
    const base = location.origin;
    const get = async (u) => new DOMParser().parseFromString(await (await fetch(u, { credentials: "include" })).text(), "text/html");
    const home = await get(base + "/");
    if (home.querySelector("#main_login_form")) return "KOOLY-ERR:login";
    const todos = [...home.querySelectorAll(".todo_container")].map((e) => ({ html: e.outerHTML, marked: !!e.closest(".is_marked") }));
    const a = [...home.querySelectorAll("a[href]")].find((x) => /^hinded$/i.test(x.textContent.trim()) || /\\/grades\\/student\\//.test(x.getAttribute("href")));
    let grades = null;
    if (a) {
      const g = await get(new URL(a.getAttribute("href"), base));
      const t = g.querySelector("table.student_lessons_grades");
      const p = [...g.querySelectorAll("h3")].map((x) => x.textContent.trim()).find((x) => /\\d+\\.\\d+\\s*[—–-]/.test(x));
      grades = { html: t ? t.innerHTML : "", period: p || "" };
    }
    return JSON.stringify({ kooly: "stuudium/1", school: location.hostname.split(".")[0], at: Date.now(), todos, grades });
    """
}

/// Невидимая страница должна быть в окне, иначе iOS может притормозить её JavaScript.
struct StuudiumFetcherView: UIViewRepresentable {
    let fetcher: StuudiumFetcher
    func makeUIView(context: Context) -> WKWebView { fetcher.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

// MARK: - Окно входа

struct StuudiumLoginView: View {
    let school: String
    let onLoggedIn: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            LoginWebView(url: URL(string: "https://\(school).ope.ee/auth/")!, onLoggedIn: onLoggedIn)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Stuudium")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Loobu") { dismiss() } }
                }
                .safeAreaInset(edge: .top) {
                    Text("Logi sisse nagu tavaliselt ja märgi „Jäta mind meelde“. Kooly sulgeb akna ise.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal)
                        .padding(.vertical, 8)
                        .background(.bar)
                }
        }
    }
}

struct LoginWebView: UIViewRepresentable {
    let url: URL
    let onLoggedIn: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onLoggedIn: onLoggedIn) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        let onLoggedIn: () -> Void
        private var done = false

        init(onLoggedIn: @escaping () -> Void) { self.onLoggedIn = onLoggedIn }

        // Вход удался: мы на *.ope.ee, не на странице входа и формы входа нет.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard !done, let url = webView.url, url.host?.hasSuffix(".ope.ee") == true, !url.path.hasPrefix("/auth") else { return }
            webView.evaluateJavaScript("!!document.querySelector('#main_login_form')") { [weak self] result, _ in
                guard let self, !self.done, (result as? Bool) == false else { return }
                self.done = true
                self.onLoggedIn()
            }
        }
    }
}
