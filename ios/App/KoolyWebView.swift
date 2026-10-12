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
        // Ощущение приложения, а не сайта: без «резинки», без зума и без сдвига вбок.
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        let noZoom = """
        (function () {
          var m = document.querySelector('meta[name=viewport]') || document.head.appendChild(document.createElement('meta'));
          m.name = 'viewport';
          m.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
        })();
        """
        config.userContentController.addUserScript(WKUserScript(source: noZoom, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        // Ошибки JavaScript — в журнал приложения (только в отладочной сборке).
        let logger = """
        window.addEventListener("error", (e) => window.webkit.messageHandlers.kooly.postMessage({ type: "log", msg: "JS error: " + e.message + " @ " + e.filename + ":" + e.lineno }));
        window.addEventListener("unhandledrejection", (e) => window.webkit.messageHandlers.kooly.postMessage({ type: "log", msg: "JS rejection: " + (e.reason && (e.reason.stack || e.reason.message) || e.reason) }));
        """
        config.userContentController.addUserScript(WKUserScript(source: logger, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        #endif

        context.coordinator.bridge = bridge
        bridge.webView = webView
        bridge.loadSite()
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        weak var bridge: NativeBridge?

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

        // Страница загрузилась: если Kooly уже нарисовался — убираем заставку (на случай старой версии без сигнала «ready»).
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                webView.evaluateJavaScript("document.getElementById('view') ? document.getElementById('view').childElementCount : 0") { result, _ in
                    if (result as? Int ?? 0) > 0 { Task { @MainActor in self?.bridge?.markReady() } }
                }
            }
            #if DEBUG
            debugDidFinish(webView)
            #endif
        }

        #if DEBUG
        func debugDidFinish(_ webView: WKWebView) {
            webView.evaluateJavaScript("[location.href, document.getElementById('view') ? document.getElementById('view').innerHTML.length : -1, innerWidth, innerHeight].join(' | ')") { r, e in
                NSLog("KoolyWeb: loaded frame=%@ page=%@ err=%@", NSCoder.string(for: webView.frame), String(describing: r), String(describing: e))
            }
            // Только для проверки в симуляторе: аргумент запуска -koolyEval "<JS>" выполняется после загрузки.
            let args = ProcessInfo.processInfo.arguments
            if let i = args.firstIndex(of: "-koolyEval"), i + 1 < args.count {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { webView.evaluateJavaScript(args[i + 1]) }
            }
        }

        #endif

        // Микрофон для ИИ-диктовки — только странице Kooly (iOS сама спросит разрешение в первый раз).
        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == KoolyShared.siteURL.host ? .grant : .deny)
        }

        // Нет сети или сайт не ответил — пробуем сохранённую копию, иначе экран «Ühendus puudub».
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in bridge?.loadFailed() }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in bridge?.loadFailed() }
        }

        // iOS выгрузила страницу из памяти (белый экран) — загрузить заново.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            Task { @MainActor in bridge?.loadSite() }
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
