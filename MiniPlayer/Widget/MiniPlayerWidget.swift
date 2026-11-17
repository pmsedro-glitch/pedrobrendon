import WidgetKit
import SwiftUI
import AppIntents

struct PlayerEntry: TimelineEntry {
    let date: Date
    let state: NowPlayingState
    let artwork: UIImage?
}

struct PlayerProvider: TimelineProvider {
    private func current() -> PlayerEntry {
        let art = SharedStore.artworkURL.flatMap { UIImage(contentsOfFile: $0.path) }
        return PlayerEntry(date: .now, state: SharedStore.load(), artwork: art)
    }
    func placeholder(in context: Context) -> PlayerEntry {
        PlayerEntry(date: .now, state: NowPlayingState(title: "Titolo brano", artist: "Artista", isPlaying: true), artwork: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (PlayerEntry) -> Void) { completion(current()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<PlayerEntry>) -> Void) {
        // L'app e gli intent ricaricano il widget a ogni cambio brano / play / pausa.
        completion(Timeline(entries: [current()], policy: .never))
    }
}

struct PlayerWidgetView: View {
    let entry: PlayerEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        HStack(spacing: 14) {
            artwork
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.state.title).font(.headline).lineLimit(2)
                Text(entry.state.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 4)
                controls
            }
            Spacer(minLength: 0)
        }
        .padding(family == .systemLarge ? 8 : 0)
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private var artwork: some View {
        Group {
            if let img = entry.artwork {
                Image(uiImage: img).resizable().scaledToFill()
            } else {
                ZStack { Color.pink.opacity(0.25); Image(systemName: "music.note").font(.largeTitle).foregroundStyle(.pink) }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var controls: some View {
        HStack(spacing: 22) {
            Button(intent: PreviousTrackIntent()) { Image(systemName: "backward.fill") }
            Button(intent: PlayPauseIntent()) {
                Image(systemName: entry.state.isPlaying ? "pause.fill" : "play.fill").font(.title2)
            }
            Button(intent: NextTrackIntent()) { Image(systemName: "forward.fill") }
        }
        .buttonStyle(.plain)
        .font(.title3)
    }
}

struct MiniPlayerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "MiniPlayerWidget", provider: PlayerProvider()) { entry in
            PlayerWidgetView(entry: entry)
        }
        .configurationDisplayName("Mini Player")
        .description("Controlla Apple Music dalla home.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct MiniPlayerWidgetBundle: WidgetBundle {
    var body: some Widget { MiniPlayerWidget() }
}
