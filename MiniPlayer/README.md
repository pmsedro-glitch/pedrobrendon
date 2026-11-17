# MiniPlayer – widget Apple Music per iPad

Widget (medium/large) con copertina, titolo, artista e pulsanti ⏮ ⏯ ⏭ che controllano Apple Music
direttamente dalla home. L'app serve a dare il permesso e a scegliere una playlist da avviare.

Richiede **iPadOS 18+**, un **Mac con Xcode 16+** e un abbonamento Apple Music attivo.

## Setup in Xcode (≈10 minuti)

1. **File › New › Project › iOS App** → nome `MiniPlayer`, SwiftUI, Swift. Elimina il `ContentView.swift`/`...App.swift` generati.
2. Imposta *Deployment target* iOS 18.0 (supporta iPad) e un tuo *Bundle Identifier*.
3. **File › New › Target › Widget Extension** → nome `MiniPlayerWidget`, **deseleziona** "Include Live Activity / Control / Configuration App Intent". Elimina i file generati.
4. Trascina i file in Xcode:
   - `App/MiniPlayerApp.swift` → target **MiniPlayer**
   - `Widget/MiniPlayerWidget.swift` → target **MiniPlayerWidget**
   - `Shared/SharedStore.swift` e `Shared/PlaybackIntents.swift` → **entrambi** i target (spunta le due caselle in *Target Membership*)
5. Su **entrambi** i target, *Signing & Capabilities*:
   - **+ Capability › App Groups** → crea `group.com.pedro.miniplayer` (o cambia `groupID` in `SharedStore.swift` con il tuo)
   - Solo sull'app: **+ Capability › MusicKit** e, in Info, aggiungi `NSAppleMusicUsageDescription` = "Serve per controllare la riproduzione."
   - Su `MiniPlayerWidget`: *Frameworks* → aggiungi `MusicKit.framework`
6. Collega l'iPad, scegli come destinazione, **Run**. Concedi l'accesso ad Apple Music, tocca una playlist.
7. Home dell'iPad → tieni premuto → **+** → *MiniPlayer* → aggiungi il widget.

## Come funziona e limiti

- Il widget non riproduce da sé: i pulsanti sono `AudioPlaybackIntent`, che iPadOS esegue nel processo dell'app (anche in background) e che comandano il `SystemMusicPlayer`, cioè lo stesso player dell'app Musica.
- Controlla quindi qualsiasi cosa stia suonando in Musica, non solo ciò che hai avviato dall'app.
- Lo stato (titolo, artista, copertina) passa dall'App Group; il widget si aggiorna quando premi un pulsante o apri l'app. Se cambi brano dall'app Musica, il widget si aggiorna alla prima interazione (WidgetKit non permette aggiornamenti continui).
- Niente barra di avanzamento in tempo reale, per lo stesso motivo.
- Il capability MusicKit può richiedere un account Apple Developer a pagamento per l'abilitazione sull'App ID.

## Non verificato

Scritto in un ambiente Linux senza Xcode: il codice **non è stato compilato né provato su dispositivo**. Se Xcode segnala errori, incollameli e li correggo.
