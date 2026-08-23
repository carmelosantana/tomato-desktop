# Tomato — Brand & Product Design Kit

Agentic Pomodoro. Standalone product brand, Linux-first (Tauri v2, web-tech frontend).

## Mockups (open in browser)
- `Tomato Brand Foundation.dc.html` — wordmark, hybrid mark, ring states, palette, type, motion (light/dark toggle)
- `Tomato Screens.dc.html` — tray & menu, grace toast + soft/DND nudges, break card, stats window, settings, onboarding (light/dark toggle)
- `Tomato Brand Guidelines.dc.html` — printable brand guidelines (export to PDF)
- `Tomato Mark Options.dc.html` — calyx exploration (reference)

## Tokens (the key hand-off)
- `tomato-tokens.json` — W3C DTCG format, Style-Dictionary compatible, light + dark
- `tomato-tokens.css` — CSS custom properties, dark override + reduced-motion
- (also copied under `assets/tokens/`)

## Assets
- `assets/marks/` — mark (color + mono), wordmark — SVG
- `assets/app-icon/` — app icon SVG + PNG (16–512)
- `assets/tray/` — menu-bar ring: `svg/` sources, `color/` + `mono/` PNG at 16/22/24/32 + @2x (44/48/64), states: idle · focus · grace · break · over-run
- `assets/icons/ui/` — 24-grid, 2px-stroke, currentColor SVG set

## Notes
- Every state pairs color with a glyph (● focus, ◑ grace, ◼ break, ▲ over-run) — color-blind-safe, WCAG-AA both themes.
- Ring geometry: diameter 84% of canvas, stroke 15% of diameter, start −90° (12 o'clock), clockwise, round cap, 2px inner gap.
- The `.dc.html` mockups need `support.js` (and `doc-page.js` for the guidelines) alongside them — both are included in this zip.
- Wordmark SVG uses live font text; convert to outlines in your vector tool for final delivery.
