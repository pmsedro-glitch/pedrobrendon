import SwiftUI
import MusicKit

@main
struct MiniPlayerApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

@MainActor
final class LibraryModel: ObservableObject {
    @Published var status: MusicAuthorization.Status = MusicAuthorization.currentStatus
    @Published var playlists: [Playlist] = []
    @Published var error: String?

    func start() async {
        status = await MusicAuthorization.request()
        guard status == .authorized else { return }
        do {
            var req = MusicLibraryRequest<Playlist>()
            req.limit = 50
            playlists = Array(try await req.response().items)
        } catch {
            self.error = error.localizedDescription
        }
        await NowPlayingSync.refresh()
    }

    func play(_ playlist: Playlist) async {
        do {
            let player = SystemMusicPlayer.shared
            player.queue = [playlist]
            try await player.play()
            try? await Task.sleep(for: .milliseconds(600))
            await NowPlayingSync.refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct ContentView: View {
    @StateObject private var model = LibraryModel()

    var body: some View {
        NavigationStack {
            Group {
                switch model.status {
                case .authorized:
                    List(model.playlists) { pl in
                        Button(pl.name) { Task { await model.play(pl) } }
                    }
                    .overlay {
                        if model.playlists.isEmpty { ContentUnavailableView("Nessuna playlist", systemImage: "music.note.list") }
                    }
                case .notDetermined:
                    ProgressView()
                default:
                    ContentUnavailableView(
                        "Accesso ad Apple Music negato",
                        systemImage: "lock",
                        description: Text("Abilitalo in Impostazioni › MiniPlayer › Contenuti multimediali e Apple Music.")
                    )
                }
            }
            .navigationTitle("MiniPlayer")
            .alert("Errore", isPresented: .constant(model.error != nil)) {
                Button("OK") { model.error = nil }
            } message: { Text(model.error ?? "") }
        }
        .task { await model.start() }
    }
}
