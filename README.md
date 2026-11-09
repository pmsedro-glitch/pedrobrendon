# Magnific Pedro per iPad

## Spaces su iPad (la parte principale)

`spaces/pedro-spaces.html` è pubblicata come pagina claude.ai: https://claude.ai/artifact/5gmLTbXApsBb489oDHeteq
Legge gli Spaces attraverso il connettore Magnific dell'account (nessun server, nessuna chiave), quindi va aperta in claude.ai o nell'app Claude sull'iPad.

- **Flusso**: ogni nodo di generazione è una scheda con i prompt (viola), i riferimenti (ambra), le impostazioni e il risultato.
- **Lavagna**: la stessa disposizione di Magnific, con pan a un dito, pinch-zoom, doppio tocco per adattare e collegamenti colorati.
- **Dettagli**: tocca un nodo per vedere immagine, impostazioni, testo completo, ingressi e uscite; si possono copiare e modificare i prompt (con conferma).
- Non avvia mai generazioni: per lanciarle si usa Magnific ("Apri nodo in Magnific").

## Upscaler (PWA)

Web app (PWA) per usare gli upscaler **Magnific** dall'iPad: si installa nella schermata Home e si apre a tutto schermo come un'app.

- **Creative**: scala 2x, 4x, 8x o 16x, prompt, *Ottimizzato per*, motore (Illusio, Sharpy, Sparkle), creatività, HDR, somiglianza e frattalità.
- **Precision**: upscale fedele all'originale, con nitidezza, grana intelligente e ultra dettaglio.
- Confronto prima/dopo trascinando il dito sull'immagine.
- Immagini da Foto, File, Fotocamera, trascinamento o incolla (Cmd+V).
- Le immagini troppo grandi vengono ridotte automaticamente, così il risultato resta sotto il limite di 25,3 MP dell'API.
- **Salva / Condividi** apre il foglio di condivisione di iPadOS ("Salva immagine" la mette in Foto).
- Cronologia salvata sull'iPad. Un upscale in corso riprende anche se chiudi l'app.
- Layout adattivo: orizzontale, verticale, Split View e Stage Manager. Tema chiaro e scuro.

## Come è fatta

```
app/       PWA statica (HTML/CSS/JS, nessuna build)
worker/    Cloudflare Worker: serve app/ e fa da proxy all'API su /api/*
```

L'API Magnific non si può chiamare direttamente da Safari (CORS), e la chiave non deve stare nel codice dell'app. Per questo un piccolo Worker serve l'app e inoltra `/api/v1/ai/*` a `api.freepik.com` (oppure `api.magnific.com`), aggiungendo la chiave.

## Pubblicazione (una volta, da un computer)

Serve un account Cloudflare gratuito e Node.js.

```bash
cd worker
npx wrangler login
npx wrangler secret put MAGNIFIC_API_KEY   # la tua chiave API
npx wrangler secret put APP_PASSWORD       # una password a tua scelta per l'app
npx wrangler deploy
```

Wrangler stampa l'indirizzo, ad esempio `https://magnific-pedro.<tuo-account>.workers.dev`.

Per usare `api.magnific.com` invece di `api.freepik.com`, imposta `UPSTREAM = "magnific"` in `worker/wrangler.toml`.

**Alternativa senza chiave sul server:** non impostare `MAGNIFIC_API_KEY`. Ogni utente inserisce la propria chiave nelle Impostazioni dell'app (resta solo sul suo iPad).

## Installazione sull'iPad

1. Apri l'indirizzo del Worker in **Safari**.
2. Tocca **Condividi → Aggiungi alla schermata Home**.
3. Apri l'app, tocca ⚙︎ e inserisci la password dell'app (oppure la tua chiave API). Usa **Prova connessione** per verificare.

## Note

- I link ai risultati sul server Magnific scadono dopo un po'. L'app ne conserva una copia sull'iPad (cronologia), ma per tenerli usa **Salva / Condividi**.
- Precision: per la stima delle dimensioni l'app considera un upscale 2x.
- Sviluppo locale: `cd worker && npx wrangler dev`, poi apri `http://localhost:8787`.
