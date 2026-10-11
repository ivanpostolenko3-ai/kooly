// Вход в Google Календарь в приложении.
// Google не пускает вход во встроенных окнах приложений, поэтому вход идёт через системное окно iOS
// (ASWebAuthenticationSession): Kooly пароль не видит, получает только разрешение на календарь.
// Долгоживущий ключ (refresh token) хранится в Связке ключей iPhone — заново входить каждый час не нужно.

import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

enum GoogleAuthError: String, Error {
    case needLogin = "need-login"
    case cancelled = "popup_closed"
    case denied = "access_denied"
    case revoked = "revoked"
    case network = "network"
}

@MainActor
final class GoogleAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GoogleAuth()

    // Ключ приложения Kooly для iPhone в Google Cloud (не секрет).
    static let clientID = "810943360481-n6o6utir2h1nl2614cvcfno1fp1augi5.apps.googleusercontent.com"
    static let scheme = "com.googleusercontent.apps.810943360481-n6o6utir2h1nl2614cvcfno1fp1augi5"
    static let redirectURI = scheme + ":/oauthredirect"
    static let scopes = [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.app.created",
    ].joined(separator: " ")

    private var accessToken: String?
    private var expiry = Date.distantPast
    private var session: ASWebAuthenticationSession?

    /// Токен для Calendar API. interactive=false — только тихо (по сохранённому ключу), без окна входа.
    func token(interactive: Bool) async throws -> (token: String, expiresIn: Int) {
        if let token = accessToken, expiry > Date().addingTimeInterval(60) {
            return (token, Int(expiry.timeIntervalSinceNow))
        }
        if let refresh = Keychain.read("googleRefreshToken") {
            do {
                return try await refreshAccess(refresh)
            } catch GoogleAuthError.revoked {
                Keychain.delete("googleRefreshToken") // доступ отозвали в Google — нужен новый вход
            }
        }
        guard interactive else { throw GoogleAuthError.needLogin }
        return try await signIn()
    }

    func signOut() {
        if let refresh = Keychain.read("googleRefreshToken") {
            var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/revoke")!)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = form(["token": refresh])
            URLSession.shared.dataTask(with: request).resume()
        }
        Keychain.delete("googleRefreshToken")
        accessToken = nil
        expiry = .distantPast
    }

    // MARK: Вход (OAuth 2.0 с PKCE — без секрета в приложении)

    private func signIn() async throws -> (token: String, expiresIn: Int) {
        let verifier = Self.randomString(64)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let state = Self.randomString(16)
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            .init(name: "client_id", value: Self.clientID),
            .init(name: "redirect_uri", value: Self.redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: Self.scopes),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "access_type", value: "offline"),
            .init(name: "prompt", value: "consent"),
            .init(name: "state", value: state),
        ]

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let done: (URL?, Error?) -> Void = { url, error in
                if let url { continuation.resume(returning: url) }
                else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin { continuation.resume(throwing: GoogleAuthError.cancelled) }
                else { continuation.resume(throwing: GoogleAuthError.cancelled) }
            }
            let session: ASWebAuthenticationSession
            if #available(iOS 17.4, *) {
                session = ASWebAuthenticationSession(url: components.url!, callback: .customScheme(Self.scheme), completionHandler: done)
            } else {
                session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: Self.scheme, completionHandler: done)
            }
            session.presentationContextProvider = self
            self.session = session
            session.start()
        }

        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if items.first(where: { $0.name == "error" }) != nil { throw GoogleAuthError.denied }
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else { throw GoogleAuthError.denied }

        let json = try await post(["code": code, "client_id": Self.clientID, "code_verifier": verifier,
                                   "redirect_uri": Self.redirectURI, "grant_type": "authorization_code"])
        if let refresh = json["refresh_token"] as? String { Keychain.save("googleRefreshToken", refresh) }
        return try store(json)
    }

    private func refreshAccess(_ refresh: String) async throws -> (token: String, expiresIn: Int) {
        let json = try await post(["refresh_token": refresh, "client_id": Self.clientID, "grant_type": "refresh_token"])
        return try store(json)
    }

    private func store(_ json: [String: Any]) throws -> (token: String, expiresIn: Int) {
        guard let token = json["access_token"] as? String else { throw GoogleAuthError.denied }
        let expiresIn = (json["expires_in"] as? Int) ?? 3600
        accessToken = token
        expiry = Date().addingTimeInterval(TimeInterval(expiresIn))
        return (token, expiresIn)
    }

    private func post(_ params: [String: String]) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = form(params)
        let data: Data
        do {
            (data, _) = try await URLSession.shared.data(for: request)
        } catch {
            throw GoogleAuthError.network
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if (json["error"] as? String) == "invalid_grant" { throw GoogleAuthError.revoked }
        return json
    }

    private func form(_ params: [String: String]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return params.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&").data(using: .utf8)!
    }

    private static func randomString(_ length: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        return Data(bytes).base64URL.prefix(length).description
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// Простая обёртка над Связкой ключей iPhone.
enum Keychain {
    private static let service = "ee.kooly.google"

    static func save(_ key: String, _ value: String) {
        delete(key)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key,
                                    kSecValueData as String: Data(value.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        SecItemAdd(query as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key,
                                    kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
    }
}
