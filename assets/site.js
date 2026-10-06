/* ═══════════════════════════════════════════════════════════════════════════
   site.js — Console shared mobile drawer nav (Task 14-a, 2026-10-02)
   One mobile menu for every page of the ops console. Replaces the broken
   per-page phone menus (owner report: "תפריט שבור בסלולר").

   Contract (honest, checkable):
   · A11y: <button> with aria-expanded + aria-controls, Escape closes,
     focus moves into the drawer on open and returns to the burger on close,
     44px+ touch targets (site.css), links are real <a> elements.
   · RTL aware: html[dir=rtl] slides from the correct edge.
   · Idempotent: if the page already manages a #burger (index.html), the
     drawer is not injected — the page keeps its own menu; the sticky-footer
     helper still applies when a direct-child <footer> exists.
   · No simulation: every link points at a page that exists in this repo.
   · R65 (2026-10-06): a second IIFE below adds the motion & life layer —
     reading progress, count-up on live data landing, pending shimmer.
     All information-bearing, all reduced-motion aware, all fail-silent.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* the ops console's real page set (existing files only) */
  var GROUPS = [
    {
      label: "Console", items: [
        { href: "index.html", label: "Console", icon: "M3 9.5 12 3l9 6.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z M9 21.5V13h6v8.5" },
        { href: "wallet.html", label: "Wallet", icon: "M21 12V7H5a2 2 0 0 1 0-4h14v4 M3 5v14a2 2 0 0 0 2 2h16v-6 M18 12a2 2 0 0 0 0 4h4v-4z" },
        { href: "gate.html", label: "Operator Gate", icon: "M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M18.4 5.6l-2.8 2.8 M8.4 15.6l-2.8 2.8" },
        { href: "truth.html", label: "Truth Gate", icon: "M12 3l7 4v5c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V7z M9 12l2 2 4-4" }
      ]
    },
    {
      label: "Network", items: [
        { href: "net.html", label: "Network Mirror", icon: "M3 3v18h18 M7 15v-3 M12 15V8 M17 15v-7" },
        { href: "receipts/", label: "Receipts Wall", icon: "M4 4h16v16l-2.5-1.5L15 20l-2.5-1.5L10 20l-2.5-1.5L5 20l-1-1z" },
        { href: "sovereign-anchor.html", label: "Sovereign Anchor", icon: "M12 8v13 M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M5 13a7 7 0 0 0 14 0" }
      ]
    },
    {
      label: "Understand", items: [
        { href: "money.html", label: "Money Map", icon: "M3 6h18v12H3z M3 10h18 M7 15h4" },
        { href: "deposits.html", label: "Deposits", icon: "M12 3v12 M7 10l5 5 5-5 M4 21h16" },
        { href: "defi.html", label: "DeFi Map", icon: "M3 3v18h18 M7 11l3-3 3 3 4-5" },
        { href: "readiness.html", label: "Readiness", icon: "M9 11l3 3 8-8 M21 12a9 9 0 1 1-9-9" },
        { href: "acid.html", label: "Discovery Engine", icon: "M10 2v6L4 20a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 8V2 M8 2h8" },
        { href: "sovereign.html", label: "Sovereign Run", icon: "M20 12c0 4.5-3.4 6.9-7.6 8.5a1 1 0 0 1-.8 0C7.4 18.9 4 16.5 4 12V6a1 1 0 0 1 1-1c2 0 4.4-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.6 3.8 17 5 19 5a1 1 0 0 1 1 1z" }
      ]
    },
    {
      label: "More", items: [
        { href: "hub/", label: "Content Hub", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" },
        { href: "versus.html", label: "Versus", icon: "M8 3H3v5 M16 21h5v-5 M3 3l7 7 M21 21l-7-7" },
        { href: "about/", label: "About", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01" },
        { href: "pitch/", label: "Pitch", icon: "M2 3h20 M4 3v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3 M12 16v5 M8 21h8" },
        { href: "onepager/", label: "One Pager", icon: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" },
        { href: "deck/", label: "Partner Deck", icon: "M12 2l10 6-10 6L2 8z M2 14l10 6 10-6" }
      ]
    }
  ];

  var SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  var SVG_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function icon(d) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  /* ── base-path derivation (14-a fix): subdirectory pages wire this file as
     ../assets/site.js, ../../assets/site.js … — the script's own src encodes
     the depth, so the drawer links get the exact same prefix and never 404. ── */
  var PREFIX = "";
  (function () {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].getAttribute("src") || "";
      if (/(^|[\\/])assets[\\/]site\.js$/.test(src)) {
        PREFIX = src.slice(0, src.lastIndexOf("assets/")); /* "", "../", "../../" … */
        return;
      }
    }
  })();

  /* ── current-page detection (resolved against the real site root) ── */
  function here(path) {
    try {
      var target = new URL(PREFIX + path, location.href).pathname;
      /* directory roots (/about/) serve their own index.html — normalize both sides */
      var norm = function (u) { return u.endsWith("/") ? u + "index.html" : u; };
      return norm(target) === norm(location.pathname);
    } catch (e) { return false; }
  }

  function buildDrawer() {
    var scrim = el("div", "sw-scrim"); scrim.hidden = false;
    var drawer = el("div", "sw-drawer");
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    drawer.setAttribute("aria-label", "Menu");
    var head = el("div", "sw-head");
    var title = el("b", null, "SAOS · Console");
    var close = el("button", "sw-close", SVG_CLOSE);
    close.setAttribute("aria-label", "Close menu");
    head.appendChild(title); head.appendChild(close);
    drawer.appendChild(head);
    var nav = el("nav");
    GROUPS.forEach(function (g) {
      nav.appendChild(el("div", "sw-group", g.label));
      g.items.forEach(function (it) {
        var a = el("a", null, icon(it.icon) + "<span></span>");
        a.firstChild.nextSibling.textContent = it.label; /* textContent, no injection */
        a.setAttribute("href", PREFIX + it.href);
        if (here(it.href)) a.classList.add("on");
        nav.appendChild(a);
      });
    });
    drawer.appendChild(nav);
    return { scrim: scrim, drawer: drawer, close: close, nav: nav };
  }

  /* ── sticky-footer helper: only when a direct-child footer really exists ── */
  function stickyFooter() {
    var has = false;
    for (var i = 0; i < document.body.children.length; i++) {
      if (document.body.children[i].tagName === "FOOTER") { has = true; break; }
    }
    if (has) document.body.classList.add("sw-sticky");
  }

  function init() {
    stickyFooter();
    if (document.getElementById("burger")) return; /* page manages its own mobile menu (index) */

    var header = document.querySelector("header.site") || document.querySelector("header");
    if (!header) return;
    var mount = header.querySelector(".hright") || header.querySelector(".hd") ||
                header.querySelector(".hwrap") || header.querySelector(".wrap") || header;
    if (mount.querySelector(".sw-burger")) return;

    var burger = el("button", "sw-burger", SVG_OPEN);
    burger.setAttribute("aria-label", "Menu");
    burger.setAttribute("aria-expanded", "false");
    burger.setAttribute("aria-controls", "sw-drawer");
    mount.appendChild(burger);

    var ui = buildDrawer();
    ui.drawer.id = "sw-drawer";
    document.body.appendChild(ui.scrim);
    document.body.appendChild(ui.drawer);

    var open = false;
    function set(next) {
      if (next === open) return;
      open = next;
      ui.scrim.setAttribute("data-open", open ? "1" : "0");
      ui.drawer.setAttribute("data-open", open ? "1" : "0");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.documentElement.style.overflow = open ? "hidden" : "";
      if (open) {
        var first = ui.nav.querySelector("a");
        if (first) first.focus();
      } else {
        burger.focus();
      }
    }
    burger.addEventListener("click", function () { set(!open); });
    ui.close.addEventListener("click", function () { set(false); });
    ui.scrim.addEventListener("click", function () { set(false); });
    ui.nav.addEventListener("click", function (e) { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) set(false); });
    window.addEventListener("resize", function () { if (window.innerWidth > 900 && open) set(false); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

/* ═══════════════════════════════════════════════════════════════════════════
   R65 — motion & life layer (2026-10-06, see DESIGN.md R65)
   Three information-bearing behaviors, nothing decorative:
   1. reading progress — a gold hairline measuring how much receipt is left;
   2. count-up — live numbers roll once when their data lands (the console is
      a live machine; a static number claiming to be live reads broken);
   3. pending shimmer — honest "measuring" state for the ... placeholders
      while a source is in flight.
   All three respect prefers-reduced-motion; all three fail silently.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var reduced = false;
  try {
    reduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (e) { reduced = false; }

  /* ── 1. reading progress + header separation on scroll ── */
  function initProgress() {
    var bar = document.createElement("div");
    bar.className = "sw-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    var doc = document.documentElement;
    var ticking = false;
    function update() {
      ticking = false;
      var max = doc.scrollHeight - window.innerHeight;
      var y = window.scrollY || doc.scrollTop || 0;
      var r = max > 40 ? Math.min(1, Math.max(0, y / max)) : 0;
      bar.style.transform = "scaleX(" + r + ")";
      if (y > 6) doc.classList.add("sw-scrolled");
      else doc.classList.remove("sw-scrolled");
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  /* ── 2. count-up when a live value lands ──
     Matches strict numerals only: optional $/#/₪ prefix, comma-grouped digits,
     optional decimals. Everything else ("0.5h", "15:25", txids) never moves. */
  var NUM_RE = /^([$#\u20AA])?\s?([\d][\d,]*(?:\.\d+)?)$/;

  function animate(el, finalText, m) {
    var prefix = m[1] || "";
    var target = parseFloat(m[2].replace(/,/g, ""));
    var dec = (m[2].split(".")[1] || "").length;
    if (isNaN(target) || target === 0) {
      /* zero / unparseable: nothing to roll. Mark as seen WITHOUT rewriting -
         a rewrite here would re-enter this observer forever (browser-proven
         2026-10-06: honest "0" values locked the page in a mutation loop). */
      el.dataset.swCounted = finalText;
      return;
    }
    el.dataset.swCounting = "1";
    var dur = 650;
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3); /* ease-out cubic */
      el.textContent = prefix + (target * e)
        .toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      if (p < 1) requestAnimationFrame(step);
      else {
        el.dataset.swCounted = finalText; /* mark BEFORE the write it legitimizes */
        el.textContent = finalText;       /* exact original form wins */
        delete el.dataset.swCounting;
      }
    }
    requestAnimationFrame(step);
  }

  function watchCounts() {
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var mu = muts[i];
        var node = mu.target;
        var el = node.nodeType === 3 ? node.parentElement : node;
        if (!el || el.nodeType !== 1) continue;
        if (el.classList.contains("sw-pend")) el.classList.remove("sw-pend");
        var t = (el.textContent || "").trim();
        var d = el.dataset;
        if (d && (d.swCounting || d.swCounted === t)) continue;
        var m = NUM_RE.exec(t);
        if (m && !reduced) animate(el, t, m);
      }
    });
    obs.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  /* ── 3. honest measuring state for "..." placeholders ── */
  var PEND_RE = /^\s*([$#\u20AA])?\s*(\.\.\.|\u2026)\s*$/;
  function markPending() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var hits = [];
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (PEND_RE.test(n.nodeValue || "") && n.parentElement) hits.push(n.parentElement);
    }
    for (var i = 0; i < hits.length; i++) hits[i].classList.add("sw-pend");
  }

  function boot() {
    try { initProgress(); } catch (e) {}
    try { markPending(); } catch (e) {}
    try { watchCounts(); } catch (e) {}
    /* late placeholders (data landed, other sources still pending) */
    setTimeout(function () { try { markPending(); } catch (e) {} }, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
