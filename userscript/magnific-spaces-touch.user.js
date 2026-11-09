// ==UserScript==
// @name         Magnific Spaces · Touch per iPad
// @namespace    pedrobrendon
// @version      1.0.0
// @description  Gesti touch sulla lavagna degli Spaces di Magnific: pinch per lo zoom, due dita per spostarsi, pressione lunga = tasto destro, tocco = passaggio del mouse.
// @match        https://www.magnific.com/*
// @match        https://magnific.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  // ---------- impostazioni (si cambiano dal pulsante ✋ in basso a destra) ----------
  const DEFAULTS = {
    enabled: true,
    panMode: "auto",       // "auto" | "native": gesti originali della lavagna | "drag": trascina la lavagna | "middle": tasto centrale | "wheel": rotella
    zoomSpeed: 1,          // moltiplicatore della sensibilità del pinch
    longPress: true,       // pressione lunga = menu del tasto destro
    hover: true,           // il tocco simula il passaggio del mouse (mostra maniglie e barre dei nodi)
  };
  const KEY = "mpTouch.settings";
  const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEFAULTS }; } };
  const settings = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} };

  const onSpaces = () => /\/spaces\//.test(location.pathname);
  // React Flow gestisce già pinch e spostamento a due dita: in automatico lo lasciamo fare
  const mode = () => settings.panMode !== "auto" ? settings.panMode
    : (findBoard() && findBoard().closest(".react-flow") ? "native" : "wheel");
  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE = 10;

  // ---------- 1. Safari non deve zoomare la pagina intera ----------
  function lockViewport() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "viewport"; (document.head || document.documentElement).appendChild(meta); }
    const want = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
    if (meta.content !== want) meta.content = want;
  }
  ["gesturestart", "gesturechange", "gestureend"].forEach((t) =>
    document.addEventListener(t, (e) => { if (settings.enabled && onSpaces()) e.preventDefault(); }, { passive: false, capture: true }));

  // ---------- 2. trova la lavagna ----------
  const CANVAS_SELECTORS = [
    ".react-flow__pane", ".react-flow__renderer", ".react-flow",
    ".tl-canvas", ".konvajs-content", "[data-testid*=canvas i]", "[class*=canvas i]", "[class*=board i]",
  ];
  let board = null;
  function findBoard() {
    if (board && board.isConnected) return board;
    for (const sel of CANVAS_SELECTORS) {
      const els = [...document.querySelectorAll(sel)].filter((el) => area(el) > innerWidth * innerHeight * 0.3);
      if (els.length) { board = els.sort((a, b) => area(b) - area(a))[0]; break; }
    }
    if (!board) {
      const cv = [...document.querySelectorAll("canvas")].sort((a, b) => area(b) - area(a))[0];
      if (cv && area(cv) > innerWidth * innerHeight * 0.3) board = cv;
    }
    if (board) {
      // la lavagna e i suoi contenitori gestiscono loro i gesti: niente scroll/zoom del browser, niente menu "copia" di iOS
      let el = board;
      for (let i = 0; el && i < 4; i++, el = el.parentElement) {
        el.style.touchAction = "none";
        el.style.webkitTouchCallout = "none";
        el.style.webkitUserSelect = "none";
      }
    }
    return board;
  }
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  const inBoard = (target) => { const b = findBoard(); return !!(b && target instanceof Node && (b.contains(target) || target.contains?.(b))); };
  const isEditable = (t) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable=''], [contenteditable=true]");

  // ---------- eventi sintetici ----------
  const at = (x, y) => document.elementFromPoint(x, y) || findBoard() || document.body;
  function wheel(x, y, dx, dy, ctrl) {
    at(x, y).dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, deltaX: dx, deltaY: dy, deltaMode: 0, ctrlKey: !!ctrl,
    }));
  }
  function mouse(type, x, y, button, buttons, target) {
    const t = target || at(x, y);
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button, buttons };
    const ptype = { mousedown: "pointerdown", mousemove: "pointermove", mouseup: "pointerup" }[type];
    if (ptype) t.dispatchEvent(new PointerEvent(ptype, { ...init, pointerId: 9999, pointerType: "mouse", isPrimary: true }));
    t.dispatchEvent(new MouseEvent(type, init));
    return t;
  }

  // ---------- 3. hover al tocco ----------
  let hovered = null;
  function hoverTo(target, x, y) {
    if (!settings.hover || target === hovered) return;
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y };
    if (hovered && hovered.isConnected) {
      hovered.dispatchEvent(new PointerEvent("pointerout", { ...init, pointerType: "mouse", relatedTarget: target }));
      hovered.dispatchEvent(new MouseEvent("mouseout", { ...init, relatedTarget: target }));
      hovered.dispatchEvent(new MouseEvent("mouseleave", { ...init, bubbles: false, relatedTarget: target }));
    }
    target.dispatchEvent(new PointerEvent("pointerover", { ...init, pointerType: "mouse", relatedTarget: hovered }));
    target.dispatchEvent(new MouseEvent("mouseover", { ...init, relatedTarget: hovered }));
    target.dispatchEvent(new MouseEvent("mouseenter", { ...init, bubbles: false, relatedTarget: hovered }));
    hovered = target;
  }

  // ---------- 4. gesti ----------
  const touchPointers = new Map(); // pointerId -> target (puntatori touch che l'app ha visto)
  let gesture = null;              // gesto a due dita in corso
  let press = null;                // possibile pressione lunga
  let swallowClick = false;

  // registra i puntatori touch che arrivano all'app, per poterli annullare quando parte un gesto a due dita
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") touchPointers.set(e.pointerId, e.target);
  }, true);
  // durante un gesto a due dita l'app non deve vedere i movimenti delle dita
  for (const t of ["pointermove", "pointerup", "pointercancel"]) {
    window.addEventListener(t, (e) => {
      if (e.pointerType !== "touch") return;
      if (gesture) e.stopImmediatePropagation();
      if (t !== "pointermove") touchPointers.delete(e.pointerId);
    }, true);
  }
  window.addEventListener("click", (e) => { if (swallowClick) { swallowClick = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  function mid(ts) { return { x: (ts[0].clientX + ts[1].clientX) / 2, y: (ts[0].clientY + ts[1].clientY) / 2 }; }
  function dist(ts) { return Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY) || 1; }

  function cancelAppPointers() {
    // chiude il trascinamento/selezione che il primo dito aveva iniziato
    for (const [id, target] of touchPointers) {
      const el = target && target.isConnected ? target : findBoard();
      el?.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, cancelable: false, composed: true, pointerId: id, pointerType: "touch" }));
    }
    touchPointers.clear();
  }

  document.addEventListener("touchstart", (e) => {
    if (!settings.enabled || !onSpaces() || isEditable(e.target) || !inBoard(e.target)) return;
    lockViewport();
    if (e.touches.length >= 2) {
      clearPress();
      if (mode() === "native") return;
      e.preventDefault(); e.stopImmediatePropagation();
      clearPress();
      if (!gesture) {
        cancelAppPointers();
        const ts = [e.touches[0], e.touches[1]];
        gesture = { m: mid(ts), d: dist(ts), dragging: false };
        const m = mode();
        if (m === "drag") { gesture.dragTarget = mouse("mousedown", gesture.m.x, gesture.m.y, 0, 1, findBoard()); gesture.dragging = true; }
        if (m === "middle") { gesture.dragTarget = mouse("mousedown", gesture.m.x, gesture.m.y, 1, 4); gesture.dragging = true; gesture.btn = [1, 4]; }
        if (gesture.dragging && !gesture.btn) gesture.btn = [0, 1];
      }
      return;
    }
    const t = e.touches[0];
    hoverTo(at(t.clientX, t.clientY), t.clientX, t.clientY);
    if (settings.longPress) {
      press = { x: t.clientX, y: t.clientY, timer: setTimeout(() => fireLongPress(), LONG_PRESS_MS) };
    }
  }, { passive: false, capture: true });

  document.addEventListener("touchmove", (e) => {
    if (!settings.enabled || !onSpaces()) return;
    if (press) {
      const t = e.touches[0];
      if (!t || Math.hypot(t.clientX - press.x, t.clientY - press.y) > MOVE_TOLERANCE) clearPress();
    }
    if (!gesture || e.touches.length < 2) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const ts = [e.touches[0], e.touches[1]];
    const m = mid(ts), d = dist(ts);
    const dx = m.x - gesture.m.x, dy = m.y - gesture.m.y;
    const ratio = d / gesture.d;

    if (Math.abs(ratio - 1) > 0.002) {
      // stessa conversione di Chrome/Safari per il pinch su trackpad: Ctrl + rotella, deltaY negativo = ingrandisci
      wheel(m.x, m.y, 0, -Math.log(ratio) * 100 * settings.zoomSpeed, true);
    }
    if (dx || dy) {
      if (gesture.dragging) mouse("mousemove", m.x, m.y, gesture.btn[0], gesture.btn[1], gesture.dragTarget);
      else wheel(m.x, m.y, -dx, -dy, false);
    }
    gesture.m = m; gesture.d = d;
  }, { passive: false, capture: true });

  function endTouch(e) {
    if (!settings.enabled || !onSpaces()) return;
    if (press && e.touches.length === 0) clearPress();
    if (gesture && e.touches.length < 2) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (gesture.dragging) mouse("mouseup", gesture.m.x, gesture.m.y, gesture.btn[0], 0, gesture.dragTarget);
      gesture = null;
      swallowClick = true; setTimeout(() => (swallowClick = false), 400);
    }
  }
  document.addEventListener("touchend", endTouch, { passive: false, capture: true });
  document.addEventListener("touchcancel", endTouch, { passive: false, capture: true });

  function clearPress() { if (press) { clearTimeout(press.timer); press = null; } }
  function fireLongPress() {
    if (!press) return;
    const { x, y } = press; press = null;
    cancelAppPointers();
    const target = at(x, y);
    const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 2, buttons: 2 };
    target.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerId: 9998, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mousedown", init));
    target.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, pointerId: 9998, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("contextmenu", { ...init, buttons: 0 }));
    swallowClick = true; setTimeout(() => (swallowClick = false), 600);
    navigator.vibrate?.(10);
  }

  // ---------- 5. pulsante impostazioni ----------
  function zoomButton(f) {
    const b = findBoard(); const r = b ? b.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (let i = 0; i < 5; i++) wheel(x, y, 0, f * 12, true);
  }
  function buildUi() {
    if (document.getElementById("mp-touch-ui") || !document.body) return;
    const host = document.createElement("div");
    host.id = "mp-touch-ui";
    host.style.cssText = "position:fixed;right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host { all: initial; }
      * { box-sizing: border-box; font: 500 14px -apple-system, system-ui, sans-serif; }
      .fab { width: 44px; height: 44px; border-radius: 50%; border: 1px solid #3a3f4b; background: #1a1c22; color: #eceef3; font-size: 20px; display: grid; place-items: center; box-shadow: 0 6px 18px rgb(0 0 0 / .4); }
      .fab.off { opacity: .5; }
      .zoom { display: grid; gap: 8px; margin-bottom: 8px; }
      .panel { position: absolute; right: 0; bottom: 56px; width: 280px; background: #1a1c22; color: #eceef3; border: 1px solid #3a3f4b; border-radius: 14px; padding: 14px; display: grid; gap: 12px; box-shadow: 0 12px 30px rgb(0 0 0 / .45); }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 36px; }
      label { color: #c7cbd4; }
      select, input[type=range] { accent-color: #a78bfa; }
      select { background: #23262e; color: #eceef3; border: 1px solid #3a3f4b; border-radius: 8px; min-height: 34px; padding: 0 8px; }
      input[type=checkbox] { width: 22px; height: 22px; accent-color: #a78bfa; }
      .diag { font: 12px ui-monospace, Menlo, monospace; color: #9097a6; white-space: pre-wrap; word-break: break-word; background: #121318; border-radius: 8px; padding: 8px; max-height: 140px; overflow: auto; }
      h4 { margin: 0; font-weight: 700; font-size: 15px; }
      [hidden] { display: none !important; }
    </style>
    <div class="zoom" id="zoom"><button class="fab" id="zin" aria-label="Ingrandisci">+</button><button class="fab" id="zout" aria-label="Riduci">−</button></div>
    <button class="fab" id="fab" aria-label="Impostazioni touch">✋</button>
    <div class="panel" id="panel" hidden>
      <h4>Touch per Magnific</h4>
      <div class="row"><label for="en">Gesti attivi</label><input type="checkbox" id="en"></div>
      <div class="row"><label for="pm">Due dita</label><select id="pm"><option value="auto">automatico</option><option value="native">gesti originali</option><option value="drag">trascina lavagna (sperimentale)</option><option value="middle">tasto centrale</option><option value="wheel">rotella</option></select></div>
      <div class="row"><label for="zs">Sensibilità zoom</label><input type="range" id="zs" min="0.3" max="3" step="0.1"></div>
      <div class="row"><label for="lp">Pressione lunga = tasto destro</label><input type="checkbox" id="lp"></div>
      <div class="row"><label for="hv">Tocco = passaggio mouse</label><input type="checkbox" id="hv"></div>
      <div class="diag" id="diag"></div>
    </div>`;
    document.body.appendChild(host);
    const $ = (id) => root.getElementById(id);
    const sync = () => {
      $("en").checked = settings.enabled; $("pm").value = settings.panMode; $("zs").value = settings.zoomSpeed;
      $("lp").checked = settings.longPress; $("hv").checked = settings.hover;
      $("fab").classList.toggle("off", !settings.enabled); $("zoom").hidden = !settings.enabled;
    };
    sync();
    $("fab").onclick = () => { $("panel").hidden = !$("panel").hidden; if (!$("panel").hidden) diag(); };
    $("en").onchange = (e) => { settings.enabled = e.target.checked; save(); sync(); };
    $("pm").onchange = (e) => { settings.panMode = e.target.value; save(); };
    $("zs").oninput = (e) => { settings.zoomSpeed = Number(e.target.value); save(); };
    $("lp").onchange = (e) => { settings.longPress = e.target.checked; save(); };
    $("hv").onchange = (e) => { settings.hover = e.target.checked; save(); };
    $("zin").onclick = () => zoomButton(-1);
    $("zout").onclick = () => zoomButton(1);
    function diag() {
      const b = findBoard();
      $("diag").textContent = b
        ? `Modalità due dita: ${mode()}\nLavagna trovata:\n<${b.tagName.toLowerCase()}${b.id ? " #" + b.id : ""}${b.className && typeof b.className === "string" ? " ." + b.className.trim().split(/\s+/).slice(0, 3).join(".") : ""}>\n${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`
        : "Lavagna non trovata. Manda a Claude uno screenshot di questo pannello.";
    }
  }
  function syncUi() {
    const ui = document.getElementById("mp-touch-ui");
    if (onSpaces()) { if (!ui) buildUi(); else ui.hidden = false; } else if (ui) ui.hidden = true;
  }

  // Magnific è un'app a pagina singola: controlla quando si entra/esce da uno Space
  const tick = () => { if (onSpaces()) { lockViewport(); findBoard(); } syncUi(); };
  const watch = () => {
    tick();
    new MutationObserver(() => { if (onSpaces() && (!board || !board.isConnected)) { board = null; tick(); } })
      .observe(document.body || document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();
  setInterval(tick, 1500);
})();
