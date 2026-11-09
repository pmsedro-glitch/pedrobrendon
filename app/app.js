// Magnific Pedro — PWA per iPad
// Parla con il Worker (stessa origine o indirizzo configurato) che inoltra all'API Magnific.

const MAX_OUTPUT_PX = 25_300_000;        // limite dell'API sui pixel del risultato
const POLL_MS = 3000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const PREVIEW_MAX = 2048;                // anteprima "prima" salvata in cronologia
const THUMB_MAX = 480;

const ENDPOINTS = {
  creative: "/api/v1/ai/image-upscaler",
  precision: "/api/v1/ai/image-upscaler-precision",
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------- impostazioni ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("mp." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("mp." + k, JSON.stringify(v)); } catch {} },
};
const settings = {
  get authMode() { return store.get("authMode", "password"); },
  get password() { return store.get("password", ""); },
  get apiKey() { return store.get("apiKey", ""); },
  get apiBase() { return (store.get("apiBase", "") || "").replace(/\/+$/, ""); },
};
function authHeaders() {
  return settings.authMode === "key"
    ? { "x-user-api-key": settings.apiKey }
    : { "x-app-password": settings.password };
}
async function api(path, init = {}) {
  const res = await fetch(settings.apiBase + path, {
    ...init,
    headers: { ...(init.headers || {}), ...authHeaders() },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { message: text }; }
  if (!res.ok) {
    const msg = body?.message || body?.detail || body?.error || `HTTP ${res.status}`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return body;
}

// ---------- IndexedDB (cronologia) ----------
const db = (() => {
  let p;
  const open = () => p ||= new Promise((resolve, reject) => {
    const req = indexedDB.open("magnific-pedro", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("jobs", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((resolve, reject) => {
      const t = d.transaction("jobs", mode);
      const r = fn(t.objectStore("jobs"));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    });
  };
  return {
    put: (job) => tx("readwrite", (s) => s.put(job)),
    get: (id) => tx("readonly", (s) => s.get(id)),
    all: () => tx("readonly", (s) => s.getAll()),
    del: (id) => tx("readwrite", (s) => s.delete(id)),
    clear: () => tx("readwrite", (s) => s.clear()),
  };
})();

// ---------- stato ----------
const state = {
  mode: "creative",
  scale: "2x",
  source: null,       // { file, img, w, h, type }
  currentJobId: null,
  polling: new Set(),
};
const objectUrls = new Set();
const blobUrl = (b) => { const u = URL.createObjectURL(b); objectUrls.add(u); return u; };

// ---------- UI di base ----------
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function setStatus(kind, html) {
  const s = $("#status");
  if (!kind) { s.hidden = true; return; }
  s.hidden = false;
  s.className = "status " + (kind === "busy" ? "" : kind);
  s.innerHTML = (kind === "busy" ? '<div class="spinner"></div>' : "") + `<span>${html}</span>`;
}

$$(".tab").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
function showView(v) {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
  if (v === "history") renderHistory();
}

// slider generati dagli attributi data-*
$$(".slider").forEach((el) => {
  const { key, min, max, def } = el.dataset;
  const saved = store.get("p." + key, Number(def));
  el.insertAdjacentHTML("beforeend",
    `<output>${saved}</output><input type="range" min="${min}" max="${max}" step="1" value="${saved}" data-key="${key}">`);
  const input = $("input", el), out = $("output", el);
  input.addEventListener("input", () => { out.textContent = input.value; store.set("p." + key, Number(input.value)); });
});
const sliderVal = (key) => Number($(`.slider input[data-key="${key}"]`).value);

// modalità
$$(".panel > .segmented .seg").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
function setMode(m) {
  state.mode = m; store.set("mode", m);
  $$(".panel > .segmented .seg").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
  $("#opts-creative").hidden = m !== "creative";
  $("#opts-precision").hidden = m !== "precision";
  updateSizeNote();
}

// scala
$$("#scaleChips .chip").forEach((c) => c.addEventListener("click", () => {
  state.scale = c.dataset.v; store.set("scale", state.scale);
  $$("#scaleChips .chip").forEach((x) => x.classList.toggle("active", x === c));
  updateSizeNote();
}));

// select / prompt persistenti
for (const id of ["optimizedFor", "engine", "prompt"]) {
  const el = $("#" + id);
  el.value = store.get(id, el.value);
  el.addEventListener("input", () => store.set(id, el.value));
}

$("#resetBtn").addEventListener("click", () => {
  $$(".slider").forEach((el) => {
    const i = $("input", el); i.value = el.dataset.def; $("output", el).textContent = i.value;
    store.set("p." + el.dataset.key, Number(i.value));
  });
  $("#optimizedFor").value = "standard"; $("#engine").value = "automatic"; $("#prompt").value = "";
  for (const id of ["optimizedFor", "engine", "prompt"]) store.set(id, $("#" + id).value);
});

// ---------- scelta immagine ----------
const fileInput = $("#fileInput");
const dz = $("#dropzone");
fileInput.addEventListener("change", () => fileInput.files[0] && loadFile(fileInput.files[0]));
$("#changeImage").addEventListener("click", () => fileInput.click());
["dragenter", "dragover"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((e) => dz.addEventListener(e, () => dz.classList.remove("drag")));
dz.addEventListener("drop", (ev) => {
  ev.preventDefault();
  const f = [...(ev.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
  if (f) loadFile(f);
});
// incolla da appunti (tastiera iPad: Cmd+V)
document.addEventListener("paste", (ev) => {
  const f = [...(ev.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
  if (f) loadFile(f);
});

async function loadFile(file) {
  try {
    const img = await decode(file);
    state.source = { file, img, w: img.naturalWidth, h: img.naturalHeight, type: file.type };
    state.currentJobId = null;
    showCompare(blobUrl(file), null);
    $("#imgInfo").textContent = `${img.naturalWidth}×${img.naturalHeight} · ${(file.size / 1e6).toFixed(1)} MB`;
    $("#runBtn").disabled = false;
    setStatus(null);
    updateSizeNote();
  } catch (e) {
    toast("Impossibile aprire l'immagine: " + e.message);
  } finally {
    fileInput.value = "";
  }
}
function decode(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("formato non supportato"));
    img.src = src instanceof Blob ? blobUrl(src) : src;
  });
}

function scaleFactor() {
  return state.mode === "creative" ? parseInt(state.scale, 10) : 2;
}
// dimensioni da inviare perché il risultato non superi il limite
function plannedInput() {
  const { w, h } = state.source;
  const s = scaleFactor();
  const maxIn = MAX_OUTPUT_PX / (s * s);
  const k = Math.min(1, Math.sqrt(maxIn / (w * h)));
  return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)), resized: k < 1, s };
}
function updateSizeNote() {
  const n = $("#sizeNote");
  if (!state.source) { n.textContent = ""; return; }
  const p = plannedInput();
  const out = `${p.w * p.s}×${p.h * p.s}`;
  n.textContent = p.resized
    ? `L'immagine verrà ridotta a ${p.w}×${p.h} prima dell'invio, per un risultato di circa ${out} (limite ${(MAX_OUTPUT_PX / 1e6).toFixed(1)} MP).`
    : `Risultato previsto: circa ${out}.`;
}

function drawTo(img, w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}
function fit(w, h, max) { const k = Math.min(1, max / Math.max(w, h)); return [Math.round(w * k), Math.round(h * k)]; }
const canvasBlob = (c, type = "image/jpeg", q = 0.9) => new Promise((r) => c.toBlob(r, type, q));

async function encodeForApi() {
  const { img, file, type } = state.source;
  const p = plannedInput();
  // se non serve ridimensionare e il file è già JPEG/PNG, lo mando così com'è
  if (!p.resized && /^image\/(jpeg|png)$/.test(type)) return blobToBase64(file);
  const c = drawTo(img, p.w, p.h);
  const keepPng = type === "image/png" && p.w * p.h <= 4_000_000;
  const dataUrl = c.toDataURL(keepPng ? "image/png" : "image/jpeg", 0.95);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
function blobToBase64(b) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

// ---------- confronto prima/dopo ----------
const compare = $("#compare");
let dragging = false;
function splitFromEvent(ev) {
  const r = compare.getBoundingClientRect();
  const v = Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100));
  applySplit(v);
}
compare.addEventListener("pointerdown", (ev) => {
  if ($("#afterWrap").hidden) return;
  dragging = true; compare.setPointerCapture(ev.pointerId); splitFromEvent(ev);
});
compare.addEventListener("pointermove", (ev) => dragging && splitFromEvent(ev));
compare.addEventListener("pointerup", () => (dragging = false));
compare.addEventListener("pointercancel", () => (dragging = false));
function applySplit(v) {
  $("#afterWrap").style.clipPath = `inset(0 0 0 ${v}%)`;
  $("#divider").style.left = v + "%";
}
function showCompare(beforeUrl, afterUrl) {
  $("#dropzone").hidden = true;
  $("#preview").hidden = false;
  $("#imgBefore").src = beforeUrl;
  const has = Boolean(afterUrl);
  $("#afterWrap").hidden = !has; $("#divider").hidden = !has; $("#tagAfter").hidden = !has;
  $("#shareResult").hidden = !has; $("#openResult").hidden = !has;
  if (has) {
    $("#imgAfter").src = afterUrl;
    $("#openResult").href = afterUrl;
    applySplit(50);
  }
}

// ---------- esecuzione ----------
$("#runBtn").addEventListener("click", run);

function collectParams() {
  if (state.mode === "creative") {
    const p = {
      scale_factor: state.scale,
      optimized_for: $("#optimizedFor").value,
      engine: $("#engine").value,
      creativity: sliderVal("creativity"),
      hdr: sliderVal("hdr"),
      resemblance: sliderVal("resemblance"),
      fractality: sliderVal("fractality"),
    };
    const prompt = $("#prompt").value.trim();
    if (prompt) p.prompt = prompt;
    return p;
  }
  return { sharpen: sliderVal("sharpen"), smart_grain: sliderVal("smart_grain"), ultra_detail: sliderVal("ultra_detail") };
}

async function run() {
  if (!state.source) return;
  if (settings.authMode === "password" ? !settings.password : !settings.apiKey) {
    openSettings(); toast("Prima imposta l'accesso all'API.");
    return;
  }
  const btn = $("#runBtn");
  btn.disabled = true;
  setStatus("busy", "Preparo l'immagine…");
  try {
    const params = collectParams();
    const image = await encodeForApi();

    const { img, w, h } = state.source;
    const [pw, ph] = fit(w, h, PREVIEW_MAX);
    const preview = await canvasBlob(drawTo(img, pw, ph), "image/jpeg", 0.88);
    const [tw, th] = fit(w, h, THUMB_MAX);
    const thumb = drawTo(img, tw, th).toDataURL("image/jpeg", 0.8);

    setStatus("busy", "Invio a Magnific…");
    const res = await api(ENDPOINTS[state.mode], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image, ...params }),
    });
    const taskId = res?.data?.task_id;
    if (!taskId) throw new Error("Risposta senza task_id");

    const p = plannedInput();
    const job = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      createdAt: Date.now(), mode: state.mode, params, taskId,
      status: res.data.status || "CREATED",
      name: state.source.file.name || "immagine",
      inW: p.w, inH: p.h, outW: p.w * p.s, outH: p.h * p.s,
      thumb, preview, resultUrl: null, resultBlob: null, error: null,
    };
    await db.put(job);
    state.currentJobId = job.id;
    poll(job.id);
  } catch (e) {
    setStatus("err", "Errore: " + escapeHtml(e.message));
  } finally {
    btn.disabled = false;
  }
}

async function poll(id) {
  if (state.polling.has(id)) return;
  state.polling.add(id);
  try {
    let job = await db.get(id);
    while (job && !["COMPLETED", "FAILED"].includes(job.status)) {
      if (Date.now() - job.createdAt > POLL_TIMEOUT_MS) {
        job.status = "FAILED"; job.error = "Tempo scaduto"; await db.put(job); break;
      }
      if (id === state.currentJobId) setStatus("busy", `Magnific sta lavorando… <span class="muted">(${statusLabel(job.status)})</span>`);
      await sleep(POLL_MS);
      if (document.hidden) continue; // Safari sospende i timer in background: riprendo al ritorno
      try {
        const r = await api(`${ENDPOINTS[job.mode]}/${encodeURIComponent(job.taskId)}`);
        const d = r?.data || {};
        job.status = d.status || job.status;
        if (job.status === "COMPLETED") job.resultUrl = (d.generated || [])[0] || null;
        if (job.status === "FAILED") job.error = d.error || "Elaborazione non riuscita";
        await db.put(job);
      } catch (e) {
        if (e.status === 401) { job.status = "FAILED"; job.error = e.message; await db.put(job); }
        // altri errori di rete: riprovo al giro dopo
      }
    }
    if (job?.status === "COMPLETED" && job.resultUrl) {
      if (id === state.currentJobId) {
        setStatus("busy", "Scarico il risultato…");
        await cacheResult(job); // così "Salva / Condividi" è immediato
        showJobInStudio(job);
        setStatus("ok", `Fatto! ${job.outW}×${job.outH}`);
      } else {
        cacheResult(job);
        toast("Upscale completato: " + job.name);
      }
    } else if (job && id === state.currentJobId) {
      setStatus("err", "Errore: " + escapeHtml(job.error || "nessun risultato"));
    }
    if ($("#view-history").classList.contains("active")) renderHistory();
  } finally {
    state.polling.delete(id);
  }
}

async function cacheResult(job) {
  if (job.resultBlob) return job.resultBlob;
  try {
    const res = await fetch(`${settings.apiBase}/api/image?url=${encodeURIComponent(job.resultUrl)}`, { headers: authHeaders() });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const fresh = await db.get(job.id);
    if (fresh) { fresh.resultBlob = blob; await db.put(fresh); }
    job.resultBlob = blob;
    return blob;
  } catch {
    return null;
  }
}

function showJobInStudio(job) {
  state.currentJobId = job.id;
  const after = job.resultBlob ? blobUrl(job.resultBlob) : job.resultUrl;
  showCompare(blobUrl(job.preview), after);
  $("#imgInfo").textContent = `${job.outW}×${job.outH} · ${modeLabel(job)}`;
  if (job.resultUrl) $("#openResult").href = job.resultUrl;
}

// ---------- salva / condividi ----------
$("#shareResult").addEventListener("click", async () => {
  const job = state.currentJobId && (await db.get(state.currentJobId));
  if (!job) return;
  await shareJob(job);
});
async function shareJob(job) {
  let blob = job.resultBlob;
  if (!blob) {
    toast("Scarico il risultato…");
    blob = await cacheResult(job);
    if (!blob) { window.open(job.resultUrl, "_blank"); return; }
    toast("Pronto: tocca di nuovo Salva / Condividi"); // Safari vuole un tocco "fresco" per la condivisione
    return;
  }
  const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const base = (job.name || "immagine").replace(/\.[^.]+$/, "");
  const file = new File([blob], `${base}_magnific_${job.mode}.${ext}`, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Magnific Pedro" }); }
    catch (e) { if (e.name !== "AbortError") toast("Condivisione non riuscita: " + e.message); }
    return;
  }
  const a = document.createElement("a");
  a.href = blobUrl(file); a.download = file.name; a.click();
}

// ---------- cronologia ----------
async function renderHistory() {
  const grid = $("#historyGrid");
  const jobs = (await db.all()).sort((a, b) => b.createdAt - a.createdAt);
  $("#historyEmpty").hidden = jobs.length > 0;
  grid.replaceChildren(...jobs.map((job) => {
    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `
      <div class="thumb"><img alt="" src="${job.thumb}"></div>
      <div class="meta">
        <strong>${escapeHtml(job.name)}</strong>
        <span class="muted">${modeLabel(job)} · ${job.outW}×${job.outH}</span>
        <span><span class="badge ${job.status}">${statusLabel(job.status)}</span>
          <span class="muted">${new Date(job.createdAt).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}</span></span>
        ${job.error ? `<span class="muted">${escapeHtml(job.error)}</span>` : ""}
      </div>
      <div class="actions">
        ${job.status === "COMPLETED" ? '<button class="btn ghost" data-a="open">Confronta</button><button class="btn ghost" data-a="share">Salva</button>' : ""}
        <button class="btn ghost" data-a="del">Elimina</button>
      </div>`;
    el.addEventListener("click", async (ev) => {
      const a = ev.target.closest("[data-a]")?.dataset.a;
      if (!a) return;
      const fresh = await db.get(job.id);
      if (a === "open") { showView("studio"); showJobInStudio(fresh); setStatus(null); }
      if (a === "share") shareJob(fresh);
      if (a === "del") { await db.del(job.id); renderHistory(); }
    });
    return el;
  }));
}
$("#clearHistory").addEventListener("click", async () => {
  if (confirm("Eliminare tutta la cronologia da questo iPad?")) { await db.clear(); renderHistory(); }
});

async function resumePending() {
  for (const job of await db.all()) {
    if (!["COMPLETED", "FAILED"].includes(job.status)) poll(job.id);
  }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) resumePending(); });

// ---------- dialog impostazioni ----------
const dlg = $("#settings");
$("#openSettings").addEventListener("click", openSettings);
function openSettings() {
  $("#appPassword").value = settings.password;
  $("#apiKey").value = settings.apiKey;
  $("#apiBase").value = settings.apiBase;
  setAuthMode(settings.authMode);
  $("#testResult").textContent = "";
  dlg.showModal();
}
$$("#authMode .seg").forEach((b) => b.addEventListener("click", () => setAuthMode(b.dataset.auth)));
function setAuthMode(m) {
  store.set("authMode", m);
  $$("#authMode .seg").forEach((b) => b.classList.toggle("active", b.dataset.auth === m));
  $("#fieldPassword").hidden = m !== "password";
  $("#fieldKey").hidden = m !== "key";
}
$("#appPassword").addEventListener("input", (e) => store.set("password", e.target.value));
$("#apiKey").addEventListener("input", (e) => store.set("apiKey", e.target.value.trim()));
$("#apiBase").addEventListener("input", (e) => store.set("apiBase", e.target.value.trim()));
$("#testConn").addEventListener("click", async () => {
  const out = $("#testResult");
  out.textContent = "Controllo…";
  try {
    const r = await api("/api/health");
    out.textContent = `✓ Collegato (${r.upstream.replace("https://", "")})`;
  } catch (e) {
    out.textContent = "✗ " + e.message;
  }
});

// ---------- utilità ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function statusLabel(s) { return { CREATED: "in coda", IN_PROGRESS: "in corso", COMPLETED: "completato", FAILED: "fallito" }[s] || s; }
function modeLabel(job) { return job.mode === "creative" ? `Creative ${job.params.scale_factor}` : "Precision"; }

// ---------- avvio ----------
setMode(store.get("mode", "creative"));
state.scale = store.get("scale", "2x");
$$("#scaleChips .chip").forEach((x) => x.classList.toggle("active", x.dataset.v === state.scale));
resumePending();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
