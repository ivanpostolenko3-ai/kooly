// Kooly — таймер в строке меню Mac.
// Читает снимок данных, который Kooly в браузере сохраняет через server.py (.kooly-state.json),
// и показывает рядом с часами: на уроке — сколько до перемены, на перемене — сколько до урока.
// До первого урока и после последнего таймер не показывается.

import AppKit
import ServiceManagement
import SwiftUI

// MARK: - Данные Kooly

struct Bell: Decodable {
    let start: String
    let end: String
}

struct Subject: Decodable {
    let id: String
    let name: String
}

struct TaskItem: Decodable, Identifiable {
    var id: String { title + due + subject }
    let title: String
    let subject: String
    let due: String
    let kind: String?
}

/// Ячейка расписания: id предмета, { s, room } после импорта из EduPage или пусто (окно).
struct Cell: Decodable {
    let subjectId: String?
    let room: String?

    private struct Object: Decodable {
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
}

struct Snapshot: Decodable {
    let updatedAt: Double
    let bells: [Bell]
    let schoolDays: Int
    let timetable: [String: [Cell]]
    let subjects: [Subject]
    let tasks: [TaskItem]
}

struct Lesson: Identifiable {
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

// MARK: - Расписание (та же логика, что в app.js)

enum Schedule {
    static let calendar = Calendar(identifier: .gregorian)

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
}

func countdown(_ seconds: TimeInterval) -> String {
    let t = max(0, Int(seconds.rounded(.up)))
    let h = t / 3600, m = (t % 3600) / 60, s = t % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
}

func hhmm(_ d: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f.string(from: d)
}

let dayNames = ["pühapäev", "esmaspäev", "teisipäev", "kolmapäev", "neljapäev", "reede", "laupäev"]

// MARK: - Модель: перечитывает файл и тикает раз в секунду

final class Model: ObservableObject {
    @Published var now = Model.fixedNow ?? Date()
    @Published var snapshot: Snapshot?
    @Published var problem: String?

    static let defaultPath = (NSHomeDirectory() as NSString).appendingPathComponent("Documents/Kooly/.kooly-state.json")
    var path: String { Model.argument("--state") ?? UserDefaults.standard.string(forKey: "statePath") ?? Model.defaultPath }

    static func argument(_ name: String) -> String? {
        let args = CommandLine.arguments
        guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    /// Для проверки: фиксированное время вместо текущего.
    static let fixedNow: Date? = argument("--now").flatMap {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return f.date(from: $0)
    }

    private var timer: Timer?
    private var lastModified: Date?

    init() {
        reload()
        let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.now = Model.fixedNow ?? Date()
            if Int(self.now.timeIntervalSince1970) % 15 == 0 { self.reload() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func reload() {
        let attrs = try? FileManager.default.attributesOfItem(atPath: path)
        guard let modified = attrs?[.modificationDate] as? Date else {
            snapshot = nil
            problem = "Ava Kooly arvutis (start.command) — siis jõuab tunniplaan siia."
            return
        }
        guard modified != lastModified else { return }
        do {
            snapshot = try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
            lastModified = modified
            problem = nil
        } catch {
            problem = "Kooly andmeid ei õnnestunud lugeda."
        }
    }

    var status: Status? { snapshot.map { Schedule.status(at: now, in: $0) } }

    /// Текст в строке меню. Таймер — только с начала первого урока до конца последнего.
    var title: String {
        switch status {
        case let .lesson(l, _)?: return "\(l.subject) \(countdown(l.end.timeIntervalSince(now)))"
        case let .breakTime(next, _)?: return "Vahetund \(countdown(next.start.timeIntervalSince(now)))"
        default: return ""
        }
    }
}

// MARK: - Окно под значком в строке меню

struct LessonRow: View {
    let lesson: Lesson
    let now: Date

    var body: some View {
        let current = now >= lesson.start && now < lesson.end
        let past = now >= lesson.end
        HStack(spacing: 10) {
            Text("\(lesson.id)")
                .font(.system(.callout, design: .rounded).weight(.bold))
                .frame(width: 24, height: 24)
                .background(current ? Color.yellow : Color.secondary.opacity(0.15), in: RoundedRectangle(cornerRadius: 7))
                .foregroundStyle(current ? Color.black : Color.primary)
            VStack(alignment: .leading, spacing: 1) {
                Text(lesson.subject).font(.callout.weight(current ? .bold : .regular))
                if let room = lesson.room, !room.isEmpty {
                    Text("ruum \(room)").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("\(hhmm(lesson.start))–\(hhmm(lesson.end))").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
        .opacity(past ? 0.45 : 1)
    }
}

struct MenuContent: View {
    @ObservedObject var model: Model
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            if let s = model.snapshot {
                let today = Schedule.lessons(on: model.now, in: s)
                if !today.isEmpty {
                    section("Täna, \(dayNames[Schedule.calendar.component(.weekday, from: model.now) - 1])") {
                        ForEach(today) { LessonRow(lesson: $0, now: model.now) }
                    }
                }
                tasks(s)
            } else if let problem = model.problem {
                Text(problem).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            HStack {
                Button("Ava Kooly") { NSWorkspace.shared.open(URL(string: "http://localhost:8000")!) }
                Spacer()
                Toggle("Käivita koos Maciga", isOn: $launchAtLogin)
                    .toggleStyle(.checkbox)
                    .font(.caption)
                    .onChange(of: launchAtLogin) { _, on in
                        do {
                            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                        } catch {
                            launchAtLogin = SMAppService.mainApp.status == .enabled
                        }
                    }
                Button("Välju") { NSApp.terminate(nil) }
            }
        }
        .padding(16)
        .frame(width: 330)
    }

    @ViewBuilder private var header: some View {
        let now = model.now
        switch model.status {
        case let .lesson(l, next)?:
            big(label: "\(l.id). tund · kuni \(hhmm(l.end))\(l.room.map { " · ruum \($0)" } ?? "")",
                title: l.subject, time: countdown(l.end.timeIntervalSince(now)), sub: "tunni lõpuni",
                progress: now.timeIntervalSince(l.start) / l.end.timeIntervalSince(l.start))
            if let next {
                Text("Järgmisena: \(next.id). \(next.subject) kell \(hhmm(next.start))").font(.caption).foregroundStyle(.secondary)
            }
        case let .breakTime(next, from)?:
            big(label: "Vahetund", title: "Järgmisena: \(next.subject)", time: countdown(next.start.timeIntervalSince(now)),
                sub: "\(next.id). tunni alguseni\(next.room.map { " · ruum \($0)" } ?? "")",
                progress: now.timeIntervalSince(from) / next.start.timeIntervalSince(from))
        case let .before(first)?:
            plain(label: "Täna", title: "Tunnid algavad kell \(hhmm(first.start))", sub: "1. tund: \(first.subject)")
        case .after?:
            plain(label: "Tänased tunnid on läbi 🎉", title: nextDayText, sub: nil)
        case .free?:
            plain(label: "Täna tunde pole 🌿", title: nextDayText, sub: nil)
        case nil:
            plain(label: "Kooly", title: "Tunniplaan puudub", sub: nil)
        }
    }

    private var nextDayText: String {
        guard let s = model.snapshot, let (day, lessons) = Schedule.nextSchoolDay(after: model.now, in: s) else { return "" }
        return "Järgmine koolipäev: \(dayNames[Schedule.calendar.component(.weekday, from: day) - 1]), algus \(hhmm(lessons[0].start))"
    }

    private func big(label: String, title: String, time: String, sub: String, progress: Double) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(time).font(.system(size: 40, weight: .heavy, design: .rounded).monospacedDigit()).foregroundStyle(Color(red: 0, green: 0.31, blue: 0.36))
            Text(sub).font(.caption).foregroundStyle(.secondary)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.18))
                    Capsule().fill(Color(red: 1, green: 0.78, blue: 0.21)).frame(width: g.size.width * min(max(progress, 0), 1))
                }
            }
            .frame(height: 8)
        }
    }

    private func plain(label: String, title: String, sub: String?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(title).font(.headline)
            if let sub { Text(sub).font(.caption).foregroundStyle(.secondary) }
        }
    }

    @ViewBuilder private func tasks(_ s: Snapshot) -> some View {
        let f = DateFormatter()
        let _ = f.dateFormat = "yyyy-MM-dd"
        let today = f.string(from: model.now)
        let tomorrow = f.string(from: Schedule.calendar.date(byAdding: .day, value: 1, to: model.now)!)
        let soon = s.tasks.filter { $0.due <= tomorrow }.sorted { $0.due < $1.due }
        if !soon.isEmpty {
            section("Ülesanded") {
                ForEach(soon.prefix(6)) { t in
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(t.subject.uppercased())\(t.kind.map { $0.isEmpty ? "" : " · \($0)" } ?? "")")
                            .font(.caption2.weight(.bold)).foregroundStyle(Color(red: 0, green: 0.31, blue: 0.36))
                        Text(t.title).font(.callout).lineLimit(2)
                        Text(t.due < today ? "Hilinenud" : t.due == today ? "Täna" : "Homme")
                            .font(.caption2).foregroundStyle(t.due < today ? Color.red : Color.secondary)
                    }
                }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.bold)).foregroundStyle(.secondary)
            content()
        }
    }
}

// MARK: - Приложение (без значка в Dock)

@main
struct KoolyMenuApp: App {
    @StateObject private var model = Model()

    init() {
        // Проверка без экрана: KoolyMenu --render out.png [--state файл] [--now время] — рисует окно и печатает текст строки меню.
        guard let out = Model.argument("--render") else { return }
        MainActor.assumeIsolated {
            let model = Model()
            print("menu bar: \(model.title.isEmpty ? "[ikoon]" : model.title)")
            let renderer = ImageRenderer(content: MenuContent(model: model).background(Color(nsColor: .windowBackgroundColor)))
            renderer.scale = 2
            if let image = renderer.nsImage, let tiff = image.tiffRepresentation,
               let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                try? png.write(to: URL(fileURLWithPath: out))
            }
        }
        exit(0)
    }

    var body: some Scene {
        MenuBarExtra {
            MenuContent(model: model)
        } label: {
            let title = model.title
            if title.isEmpty {
                Image(systemName: "graduationcap")
            } else {
                Text(title).monospacedDigit()
            }
        }
        .menuBarExtraStyle(.window)
    }
}
