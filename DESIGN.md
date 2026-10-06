# SAOS Console DESIGN.md

The design system of the SAOS public console. One file so any designer, any
engineer and any AI session can rebuild a page that looks like it belongs here.
Derived from the brand law in `hub/brand.html` and the live dark-zinc system
the console already ships. Tested against public design-system references
(styles.refero.design catalog, the "midnight command center" grade): the
language is dark, precise, receipts-first, zero decoration that does not
carry information.

## R62+ refinement (2026-10-06, measured against styles.refero.design)

The home page was rebuilt against the refero.design reference bar and the
discipline of the catalog's own "midnight command center" entries:

1. **Achromatic rationing** - the page is ~98% zinc; gold appears only on the
   brand seal, the primary CTA, key numerals and the active pill. Status
   colors (green/amber/red) are reserved for verdicts only.
2. **Depth over flatness** - every raised surface carries a hairline border
   plus an inset key-highlight (`--key: inset 0 1px 0 rgba(255,255,255,.055)`)
   and a quiet hover lift with shadow (`--key-hover`). Cards feel pressed and
   tactile, not floating stickers.
3. **Atmosphere** - one gold-tinted dawn gradient above the fold and a fading
   26px dot grid (`body::before` / `body::after`), both below the content,
   both decoration-only and removable without losing one bit of information.
4. **The beacon** - the hero is a two-column composition: the statement on
   the text side, and a live chain-witness panel (`aside.beacon`) on the
   data side: verdict badge, checkpoint, settled attestations, block, signing
   account, truncated merkle root, and one row per witness line (Steem, Z
   Chain, Optimism, Base), each opening in a public explorer.
5. **Strips, not card piles** - the six home KPIs and the five achievement
   gates render as single hairline-divided rails (1px gap over `--line`),
   matching the reference systems' stat-row pattern.
6. **Reveal integrity law** - content is visible by default; the scroll
   animation arms only when JS adds `html.js-anim`, a fallback force-reveals
   everything after 3s, and print/no-JS never lose a byte. No crawler, no
   capture and no reader may ever meet an invisible section.

## R65 refinement (2026-10-06): brand voice + a living machine

Two amendments to the laws above, both driven by the refero-grade bar:

1. **Self-hosted brand typography (amends "No webfonts")** - the intent of the
   old law was "no third-party CDN, no render-blocking external requests".
   R65 keeps the intent and drops the blanket ban: `assets/fonts/` now ships
   three subset variable woff2 files (Heebo hebrew + latin, JetBrains Mono
   latin; ~74KB total, `font-display: swap`, no CDN, no tracking). Every page
   token becomes `--sans:'Heebo',-apple-system,...` and
   `--mono:'JetBrains Mono',ui-monospace,...`. Heebo renders the true
   600/650 weights the system stack used to round away; JetBrains Mono gives
   every numeral, txid and timestamp one identical ledger voice.
2. **Motion & life layer (amends "No other animation")** - shared, additive,
   in `assets/site.js` + `assets/site.css`, all `prefers-reduced-motion`
   aware and fail-silent:
   - reading progress: a 2px gold hairline fixed at the very top, scaleX by
     scroll ratio (information: how much receipt is left to verify);
   - count-up: when a live value lands and its text is a strict numeral
     (optional `$`/`#`/`₪` prefix, comma digits, optional decimals), it rolls
     once for 650ms ease-out. Mixed strings ("0.5h", "FRESH · 0.5h", "125 /
     16") and txids never move; the final text is always set byte-exact;
   - pending shimmer: text placeholders (`...`, `$…`) get `.sw-pend` - a dim
     1.6s opacity pulse - until their data lands, replacing the dead "..."
     look with an honest "measuring" state;
   - header separation: `html.sw-scrolled` adds a hairline + shadow to the
     glass header after 6px of scroll;
   - proof tables: `tbody tr` get a faint hover wash; every page's own hover
     rule still wins (`:where()` zero specificity).

All prior laws below remain in force.

## Story

Sovereignty with receipts. The page is a control room, not a landing page:
every number on it is live, every claim carries a source note, every promise
is replaced by a link to a public chain. Gold is the color of the sovereign
seal, green is the color of a verified fact, red is an honest failure.
Nothing on the page may pretend.

## Palette

| Token | Value | Use |
|---|---|---|
| `--bg` | `#09090b` | page background |
| `--bg2` | `#0c0c0e` | drawers, elevated surfaces |
| `--panel` | `rgba(255,255,255,.03)` | card background |
| `--panel2` | `rgba(255,255,255,.05)` | card background on hover / headers |
| `--line` | `rgba(255,255,255,.09)` | card borders, dividers |
| `--line2` | `rgba(255,255,255,.16)` | hover borders |
| `--gold` | `#d4af37` | brand seal, primary accents, key icons |
| `--gold-bright` | `#e9c767` | gold hover |
| `--gold-dim` | `rgba(212,175,55,.12)` | gold-tinted backgrounds |
| `--green` | `#22c55e` | verified, FRESH, ALL-GREEN |
| `--amber` | `#eab308` | WAIT, degraded |
| `--red` | `#ef4444` | FAIL, breached |
| `--purple` | `#a78bfa` | knowledge, secondary highlights |
| `--text` | `#fafafa` | primary text |
| `--dim` | `#a1a1aa` | secondary text |
| `--faint` | `#71717a` | labels, srcnotes |

Forbidden: blue and indigo families, gradients on text, any color that is not
in this table. Emojis are banned everywhere (A14 typography law). Arrows and
em-dashes are banned in copy (A14); use SVG icons and hyphens.

## Typography

No webfonts. System stacks only (repo law: no external assets).

```
--sans: -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
        'Noto Sans Hebrew', sans-serif;
--mono: ui-monospace, 'SF Mono', 'Cascadia Code', 'Segoe UI Mono', Menlo,
        Consolas, monospace;
```

| Role | Spec |
|---|---|
| Hero H1 | clamp(2.2rem, 5.2vw, 3.9rem), weight 700, line-height 1.12 |
| Section H2 | clamp(1.5rem, 3vw, 2.2rem), weight 650 |
| Card title | 15px / 600 |
| Body | 15px / 400, line-height 1.65, color --text or --dim |
| Label | 11px, letter-spacing .8px, uppercase, color --faint |
| Numbers | --mono, always `dir="ltr"`, tabular figures |
| srcnote | 11px, --faint, mono for file names |

Hebrew is the default language, `dir="rtl"`. English flips the document to
`dir="ltr"` via the language toggle. Both directions share one stylesheet,
using logical properties (`margin-inline-start`, `inset-inline-end`).

## Spacing and shape

- 8px grid. Container: `max-width: 1180px`, inline padding 20px (16px mobile).
- Section padding: 72px desktop, 44px mobile.
- Radius: `--r: 16px` cards, `--r-sm: 12px` chips and inputs, `999px` pills.
- Card: `background: var(--panel); border: 1px solid var(--line);`
  hover: border `--line2`, translateY(-2px), transition 180ms.
- Touch targets: minimum 44px height (shared law).

## Components

1. **Pill nav** - sticky glass header (`backdrop-filter: blur(14px)`), pill
   container, active pill `background: var(--panel2)`. Mobile: the shared
   drawer from `assets/site.js` (44px targets, RTL aware).
2. **KPI card** - label (11px), value (mono 30px), srcnote (11px, source file
   and update time). Value placeholders are `...` until data lands; a failed
   source shows "not available" instead of inventing a number.
3. **Status chip** - dot (6px, --green pulse) + mono text. FRESH = green,
   WAIT = amber, FAIL = red.
4. **Receipt card** - chain badge, mono txid (truncated, dir ltr), external
   link icon, block number, source note. The txid is the design: never hide
   it behind a button.
5. **Table** - 13px, row border `--line`, header 11px uppercase --faint,
   numeric cells mono `dir="ltr"`. Scroll container max-height with custom
   scrollbar (8px, thumb `--line2`).
6. **Law banner** - full-width card with gold 2px inline-start border,
   18px text.
7. **Buttons** - primary: `background: var(--gold-dim); border: 1px solid
   rgba(212,175,55,.4); color: var(--gold-bright)`. Secondary: panel + line.
   All 44px minimum.
8. **Loop gate** - five achievement gates rendered as a horizontal strip of
   cards, each: gate name, live value, one-line meaning.
9. **Footer** - direct child of `<body>`, `margin-top: auto`, four link
   columns + the closing line "Do not trust us. Verify us." with a live
   witness link.

## Motion

- Reveal on scroll: `opacity 0 -> 1`, `translateY(10px) -> 0`, 420ms ease,
  staggered 60ms. Disabled under `prefers-reduced-motion`.
- Live dot: 2s pulse. No other animation. Nothing bounces.

## Voice

A veteran trading engineer, not a marketer. Short declarative sentences.
Every number carries its source and its date. Honest limits are printed on
the page, not hidden: zero deposits, zero external income, open operator
gates. Never call SAOS a coin, an investment or a bridge. Never promise
yield. The site's last line is always: "Do not trust us. Verify us."

## Accessibility

- Semantic landmarks: `header`, `main`, `nav`, `section[aria-labelledby]`, `footer`.
- Focus visible: 2px `--text` outline, offset 2px.
- Contrast: --dim on --bg passes 4.5:1; srcnote is 3:1+, labels never carry
  meaning alone (icon + text).
- All interactive elements keyboard reachable; drawer closes on Escape
  (handled by `assets/site.js`).
