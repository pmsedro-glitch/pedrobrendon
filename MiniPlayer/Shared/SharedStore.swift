import Foundation
import MusicKit
import WidgetKit

/// Stato del brano condiviso tra app e widget (via App Group).
struct NowPlayingState: Codable, Equatable {
    var title: String = "Nessun brano"
    var artist: String = "Avvia un brano da Apple Music"
    var isPlaying: Bool = false
}

enum SharedStore {
    /// Deve coincidere con l'App Group abilitato su ENTRAMBI i target.
    static let groupID = "group.com.pedro.miniplayer"

    private static var defaults: UserDefaults { UserDefaults(suiteName: groupID) ?? .standard }

    static var artworkURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: groupID)?
            .appendingPathComponent("artwork.jpg")
    }

    static func load() -> NowPlayingState {
        guard let data = defaults.data(forKey: "state"),
              let s = try? JSONDecoder().decode(NowPlayingState.self, from: data)
        else { return NowPlayingState() }
        return s
    }

    static func save(_ state: NowPlayingState) {
        if let data = try? JSONEncoder().encode(state) { defaults.set(data, forKey: "state") }
    }
}

/// Legge il player di sistema (app Musica), aggiorna lo stato condiviso e ricarica il widget.
enum NowPlayingSync {
    static func refresh() async {
        let player = SystemMusicPlayer.shared
        var s = SharedStore.load()

        if let entry = player.queue.currentEntry {
            let changed = entry.title != s.title
            s.title = entry.title
            s.artist = entry.subtitle ?? ""
            if changed { await saveArtwork(entry.artwork) }
        }
        s.isPlaying = player.state.playbackStatus == .playing

        SharedStore.save(s)
        WidgetCenter.shared.reloadAllTimelines()
    }

    private static func saveArtwork(_ artwork: Artwork?) async {
        guard let dest = SharedStore.artworkURL else { return }
        guard let url = artwork?.url(width: 600, height: 600),
              url.scheme?.hasPrefix("http") == true,
              let (data, _) = try? await URLSession.shared.data(from: url)
        else {
            try? FileManager.default.removeItem(at: dest)
            return
        }
        try? data.write(to: dest, options: .atomic)
    }
}
