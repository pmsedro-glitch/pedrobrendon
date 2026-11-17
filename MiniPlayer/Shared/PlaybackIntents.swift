import AppIntents
import MusicKit

// AudioPlaybackIntent (iOS 18+ / iPadOS 18+): il sistema esegue questi intent
// nel processo dell'app, quindi il widget può controllare la musica senza aprirla.

struct PlayPauseIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Play / Pausa"

    func perform() async throws -> some IntentResult {
        let player = SystemMusicPlayer.shared
        if player.state.playbackStatus == .playing {
            player.pause()
        } else {
            try await player.play()
        }
        try? await Task.sleep(for: .milliseconds(400))
        await NowPlayingSync.refresh()
        return .result()
    }
}

struct NextTrackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Brano successivo"

    func perform() async throws -> some IntentResult {
        try await SystemMusicPlayer.shared.skipToNextEntry()
        try? await Task.sleep(for: .milliseconds(600))
        await NowPlayingSync.refresh()
        return .result()
    }
}

struct PreviousTrackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Brano precedente"

    func perform() async throws -> some IntentResult {
        try await SystemMusicPlayer.shared.skipToPreviousEntry()
        try? await Task.sleep(for: .milliseconds(600))
        await NowPlayingSync.refresh()
        return .result()
    }
}
