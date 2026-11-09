/**
 * Magnific Pedro — Cloudflare Worker
 *
 * - Serve la PWA statica (cartella ../app) tramite il binding ASSETS.
 * - Fa da proxy verso l'API Magnific/Freepik su /api/v1/ai/*, aggiungendo
 *   la chiave API e le intestazioni CORS (l'API non accetta chiamate dirette
 *   dal browser, e la chiave non deve stare nel codice del client).
 * - /api/image?url=...  scarica un risultato dal CDN, così l'iPad può
 *   salvarlo in Foto / condividerlo come file.
 *
 * Variabili (wrangler secret put ...):
 *   MAGNIFIC_API_KEY  chiave API (facoltativa: senza, ogni utente usa la propria)
 *   APP_PASSWORD      obbligatoria se MAGNIFIC_API_KEY è impostata
 * Variabili normali (wrangler.toml [vars]):
 *   UPSTREAM          "freepik" (default) oppure "magnific"
 *   IMAGE_HOSTS       domini consentiti per /api/image, separati da virgola
 */

const UPSTREAMS = {
  freepik: { base: "https://api.freepik.com", header: "x-freepik-api-key" },
  magnific: { base: "https://api.magnific.com", header: "x-magnific-api-key" },
};

const DEFAULT_IMAGE_HOSTS = "freepik.com,cdnpk.net,magnific.com,magnific.ai,amazonaws.com,googleapis.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: "proxy_error", message: String(err && err.message || err) }, 502);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  const auth = resolveKey(request, env);
  if (auth.error) return json({ error: auth.error, message: auth.message }, auth.status);

  if (url.pathname === "/api/health") {
    return json({ ok: true, upstream: upstreamOf(env).base, serverKey: Boolean(env.MAGNIFIC_API_KEY) });
  }

  if (url.pathname === "/api/image") return proxyImage(url, env);

  if (!url.pathname.startsWith("/api/v1/ai/")) return json({ error: "not_found" }, 404);
  if (!["GET", "POST"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);

  const up = upstreamOf(env);
  const target = up.base + url.pathname.slice(4) + url.search; // toglie "/api"
  const headers = new Headers({ "accept": "application/json", [up.header]: auth.key });
  const init = { method: request.method, headers };
  if (request.method === "POST") {
    headers.set("content-type", "application/json");
    init.body = await request.text();
  }
  const res = await fetch(target, init);
  const out = new Headers(cors());
  out.set("content-type", res.headers.get("content-type") || "application/json");
  return new Response(res.body, { status: res.status, headers: out });
}

function resolveKey(request, env) {
  const userKey = request.headers.get("x-user-api-key");
  if (userKey) return { key: userKey };
  if (!env.MAGNIFIC_API_KEY) {
    return { error: "missing_key", status: 401, message: "Nessuna chiave API: inseriscila nelle Impostazioni dell'app." };
  }
  if (!env.APP_PASSWORD) {
    return { error: "insecure_config", status: 503, message: "Sul server manca APP_PASSWORD: impostala con `wrangler secret put APP_PASSWORD`." };
  }
  if (!safeEqual(request.headers.get("x-app-password") || "", env.APP_PASSWORD)) {
    return { error: "bad_password", status: 401, message: "Password dell'app errata." };
  }
  return { key: env.MAGNIFIC_API_KEY };
}

async function proxyImage(url, env) {
  const raw = url.searchParams.get("url");
  let target;
  try { target = new URL(raw); } catch { return json({ error: "bad_url" }, 400); }
  const allowed = (env.IMAGE_HOSTS || DEFAULT_IMAGE_HOSTS).split(",").map((s) => s.trim()).filter(Boolean);
  const host = target.hostname;
  if (target.protocol !== "https:" || !allowed.some((d) => host === d || host.endsWith("." + d))) {
    return json({ error: "host_not_allowed", host }, 403);
  }
  const res = await fetch(target.toString());
  const out = new Headers(cors());
  out.set("content-type", res.headers.get("content-type") || "application/octet-stream");
  out.set("cache-control", "private, max-age=86400");
  return new Response(res.body, { status: res.status, headers: out });
}

function upstreamOf(env) {
  return UPSTREAMS[(env.UPSTREAM || "freepik").toLowerCase()] || UPSTREAMS.freepik;
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-app-password,x-user-api-key",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors(), "content-type": "application/json" } });
}
