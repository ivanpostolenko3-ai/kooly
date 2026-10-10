// Окно с Kooly: сайт открывается внутри приложения и обновляется сам (новые версии приходят без переустановки).

import SafariServices
import SwiftUI
import WebKit

struct KoolyWebView: UIViewRepresentable {
    let bridge: NativeBridge

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // данные Kooly (localStorage) сохраняются между запусками
        config.userContentController.add(bridge, name: "kooly")
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never // отступы под чёлку и полоску делает сам Kooly
        webView.scrollView.bounces = true
        webView.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif

        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.reload(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        bridge.webView = webView
        webView.load(URLRequest(url: KoolyShared.siteURL, cachePolicy: .reloadRevalidatingCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        @objc func reload(_ sender: UIRefreshControl) {
            (sender.superview?.superview as? WKWebView)?.reload()
            sender.endRefreshing()
        }

        // Ссылки на другие сайты (Opiq, Stuudium, PDF меню…) — в Safari внутри приложения.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .allow }
            if url.host == KoolyShared.siteURL.host || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
                return .allow
            }
            if action.navigationType == .linkActivated || action.targetFrame == nil {
                open(url, from: webView)
                return .cancel
            }
            return .allow
        }

        // target="_blank" и window.open
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { open(url, from: webView) }
            return nil
        }

        // Если веб-процесс выгрузили из памяти — просто перезагрузить.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        private func open(_ url: URL, from webView: WKWebView) {
            guard ["http", "https"].contains(url.scheme ?? "") else {
                UIApplication.shared.open(url)
                return
            }
            let safari = SFSafariViewController(url: url)
            webView.window?.rootViewController?.topMost.present(safari, animated: true)
        }
    }
}

extension UIViewController {
    var topMost: UIViewController { presentedViewController?.topMost ?? self }
}
