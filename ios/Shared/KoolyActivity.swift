// Live Activity (Dynamic Island и экран блокировки): текущий урок или перемена с обратным отсчётом.

import ActivityKit
import Foundation

struct KoolyActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var isLesson: Bool
        var title: String // «Inglise keel» или «Vahetund»
        var detail: String // «2. tund · ruum 304» или «Järgmisena: Eesti keel · ruum 306»
        var start: Date
        var end: Date
    }
}

extension KoolyActivityAttributes.ContentState {
    /// Состояние для момента now; nil — до первого урока, после последнего и в выходные (отсчёт не нужен).
    static func make(at now: Date, from snapshot: Snapshot) -> Self? {
        switch Schedule.status(at: now, in: snapshot) {
        case let .lesson(l, next):
            var detail = "\(l.id). tund"
            if let room = l.room, !room.isEmpty { detail += " · ruum \(room)" }
            if let next { detail += " · siis \(next.subject)" }
            return .init(isLesson: true, title: l.subject, detail: detail, start: l.start, end: l.end)
        case let .breakTime(next, from):
            var detail = "Järgmisena: \(next.subject)"
            if let room = next.room, !room.isEmpty { detail += " · ruum \(room)" }
            return .init(isLesson: false, title: "Vahetund", detail: detail, start: from, end: next.start)
        default:
            return nil
        }
    }
}
