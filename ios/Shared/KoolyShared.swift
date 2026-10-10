// Общее для приложения и виджетов: данные Kooly (снимок из веб-части) и расчёт расписания.
// Логика та же, что в app.js и mac/KoolyMenu: на уроке — до перемены, на перемене — до урока.

import Foundation

// MARK: - Где лежат данные (общая папка приложения и виджетов)

enum KoolyShared {
    static let appGroup = "group.ee.kooly.ivan"
    static let siteURL = URL(string: "https://ivanpostolenko3-ai.github.io/kooly/")!

    static var containerURL: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    static var snapshotURL: URL { containerURL.appendingPathComponent("snapshot.json") }

    static func loadSnapshot() -> Snapshot? {
        guard let data = try? Data(contentsOf: snapshotURL) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    static func saveSnapshot(_ data: Data) {
        try? data.write(to: snapshotURL, options: .atomic)
    }
}

// MARK: - Снимок данных Kooly (то, что присылает shareState() в app.js)

struct Bell: Codable {
    let start: String
    let end: String
}

struct Subject: Codable {
    let id: String
    let name: String
}

struct TaskItem: Codable {
    let title: String
    let subject: String
    let due: String
    let kind: String?
}

struct PlannedNotification: Codable {
    let id: String
    let at: Double // миллисекунды, как Date.now() в JS
    let title: String
    let body: String
    let tab: String?
}

/// Ячейка расписания: id предмета, { s, room } после импорта из EduPage или пусто (окно).
struct Cell: Codable {
    let subjectId: String?
    let room: String?

    private struct Object: Codable {
        let s: String?
        let room: String?
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            subjectId = nil; room = nil
        } else if let id = try? c.decode(String.self) {
            subjectId = id; room = nil
        } else {
            let o = try c.decode(Object.self)
            subjectId = o.s; room = o.room
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(Object(s: subjectId, room: room))
    }
}

struct Snapshot: Codable {
    let updatedAt: Double
    let bells: [Bell]
    let schoolDays: Int
    let timetable: [String: [Cell]]
    let subjects: [Subject]
    let tasks: [TaskItem]
    let notify: Bool?
    let notifications: [PlannedNotification]?
}

// MARK: - Расписание

struct Lesson: Identifiable, Hashable {
    let id: Int // номер урока
    let subject: String
    let room: String?
    let start: Date
    let end: Date
}

enum Status {
    case lesson(Lesson, next: Lesson?)
    case breakTime(next: Lesson, from: Date)
    case before(first: Lesson)
    case after
    case free
}

enum Schedule {
    static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Tallinn") ?? .current
        return c
    }

    static func time(_ hhmm: String, on day: Date) -> Date? {
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2 else { return nil }
        return calendar.date(bySettingHour: p[0], minute: p[1], second: 0, of: day)
    }

    static func lessons(on day: Date, in s: Snapshot) -> [Lesson] {
        let jsDay = calendar.component(.weekday, from: day) - 1 // 0 = pühapäev, как в JS
        guard jsDay != 0, jsDay <= s.schoolDays, let row = s.timetable[String(jsDay)] else { return [] }
        let names = Dictionary(s.subjects.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
        var out: [Lesson] = []
        for (i, cell) in row.enumerated() {
            guard i < s.bells.count, let id = cell.subjectId, let name = names[id],
                  let start = time(s.bells[i].start, on: day), let end = time(s.bells[i].end, on: day) else { continue }
            out.append(Lesson(id: i + 1, subject: name, room: cell.room, start: start, end: end))
        }
        return out
    }

    static func status(at now: Date, in s: Snapshot) -> Status {
        let today = lessons(on: now, in: s)
        guard !today.isEmpty else { return .free }
        if let i = today.firstIndex(where: { now >= $0.start && now < $0.end }) {
            return .lesson(today[i], next: i + 1 < today.count ? today[i + 1] : nil)
        }
        if let i = today.firstIndex(where: { $0.start > now }) {
            return i == 0 ? .before(first: today[0]) : .breakTime(next: today[i], from: today[i - 1].end)
        }
        return .after
    }

    static func nextSchoolDay(after now: Date, in s: Snapshot) -> (Date, [Lesson])? {
        for i in 1...14 {
            guard let d = calendar.date(byAdding: .day, value: i, to: calendar.startOfDay(for: now)) else { continue }
            let l = lessons(on: d, in: s)
            if !l.isEmpty { return (d, l) }
        }
        return nil
    }

    /// Моменты, когда меняется состояние (начало и конец каждого урока) — для виджетов и Dynamic Island.
    static func boundaries(from now: Date, days: Int, in s: Snapshot) -> [Date] {
        var out: [Date] = []
        for i in 0...days {
            guard let d = calendar.date(byAdding: .day, value: i, to: now) else { continue }
            for l in lessons(on: d, in: s) { out += [l.start, l.end] }
        }
        return out.filter { $0 > now }.sorted()
    }
}

func hhmm(_ d: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    f.timeZone = Schedule.calendar.timeZone
    return f.string(from: d)
}

let dayNames = ["pühapäev", "esmaspäev", "teisipäev", "kolmapäev", "neljapäev", "reede", "laupäev"]
