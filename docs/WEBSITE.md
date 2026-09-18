# Website / GitHub Pages

This is a hand-written static, Chinese-first project website. It does not expose
or connect to the MCP service. No build step, frontend framework, CDN, analytics,
or backend is needed to publish the files in `docs`.

## Preview and test

```powershell
npm.cmd run site:serve
npm.cmd run site:test
```

Open `http://127.0.0.1:4173/Wheel-mcp/`. The local-only server binds to loopback
and intentionally uses the repository subpath to catch Pages path errors.
`PORT=...` can override 4173. Stop the terminal process with Ctrl+C.

- `index.html`: project landing page, SVG runtime diagram, selectable workflow,
  benchmark visualization, GitHub quick-start CTA and Rust Ring immersive-play
  modal.
- Rust Ring iframe target: `http://niumaweilai.cn/rust-ring/`; the modal is
  responsive, lazy-loads the frame, supports Escape/backdrop close, and provides
  a new-tab fallback.
- `games/index.html`: filterable game gallery.
- `games/orbit-breaker/index.html`: original Canvas brick breaker.
- `games/circuit-snake/index.html`: original Canvas snake.
- `games/signal-match/index.html`: original DOM memory game.
- `games/godot-lab/index.html`: explicitly empty Godot Web slot.
- `guide.html`: documentation navigation, game integration and deployment guide.
- `site/`: shared styles and scripts.
- `assets/icons/`: published brand, AI client and Godot icons.
- `AGENT-COMPATIBILITY.md`: client matrix and the `npm.cmd run go:global` setup boundary.

The original demo games are **not** Godot exports, upstream games, MCP-generated
works or benchmark evidence. Their best scores use localStorage only; unavailable
storage does not prevent playing. Switching tabs pauses games. Canvas games are
visual games, not fully screen-reader-playable; the memory game has labeled
buttons and keyboard support. No audio is included.

## External Rust Ring iframe note

The landing page opens the external Rust Ring game in a modal instead of bundling
or proxying it. The supplied endpoint is HTTP. When the site is deployed on HTTPS
GitHub Pages, browsers may block that iframe as mixed content; this is a browser
security rule and cannot be bypassed from static frontend code. In that case use
the modal's **???????** fallback, or arrange an HTTPS version of the game
at the origin/CDN. Do not add a client-side proxy or attempt to disable browser
security.

## Add a Godot game

1. Verify Web export support for the exact engine and project language version.
2. Prefer the Compatibility renderer and disable thread support for basic Pages
   hosting. A threaded build needs cross-origin isolation headers; do not assume
   Pages provides them. This site installs no service worker workaround.
3. Put the **entire** export into `docs/games/godot-lab/web/`, including HTML, JS,
   WASM, PCK and all companion files. Retain their relative paths and filenames.
4. Test `.../Wheel-mcp/games/godot-lab/web/index.html` directly. Add a start link
   in the slot page, or embed the export with a titled iframe:

   ```html
   <iframe
     title="Your game"
     src="./web/index.html"
     width="960"
     height="540"
     allow="fullscreen; autoplay; gamepad"
     allowfullscreen
   ></iframe>
   ```

   Prefer loading an iframe only after a player starts it; provide a direct link
   fallback. Test keyboard focus, audio activation, fullscreen and mobile input.

5. Update the gallery card status and filter counts, preview image, controls,
   attribution and license. Do not mark a slot playable before verifying it.
6. For more slots, duplicate the placeholder directory and add a gallery card.
   Never include `.env`, private project files or secrets in the published folder.

Large WASM/PCK files may exceed GitHub repository or Pages limits. The local
preview is intended for these small static pages, not a production file server.
No actual Godot export is included or validated in this change.

## Publish

Commit the site to `main`, then configure the repository:

`Settings → Pages → Deploy from a branch → main → /docs → Save`

`.nojekyll` opts out of Jekyll processing. Existing Markdown files remain in place
and can be fetched as raw documents; this website links API docs to the GitHub
rendered versions. All browser assets and internal links are relative, so the
site also works if the Pages project path changes. The local preview server's
prefix is only a development convention and is not part of deployed files.

Expected default URL (only **after** deployment):
`https://evedensity.github.io/Wheel-mcp/`.

This change does not create a commit, push, or enable Pages in repository settings.

## Design references and primary hosting documentation

Research date: 2026-09-15. Inspiration only, not copied source or assets. The visual direction combines developer-tool clarity, editorial showcase pacing, game-oriented spectacle, restrained neon contrast, SVG systems graphics, Canvas particles, scroll reveals, magnetic CTAs and reduced-motion fallbacks:

- Vite: https://vite.dev/ — clear developer-tool hero and feature narrative.
- Astro: https://astro.build/ — project showcase and structured exploration.
- Godot: https://godotengine.org/showcase/ — game-oriented showcase context.
- Godot Web exports:
  https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- GitHub Pages publishing source:
  https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

Visuals and demos are independently implemented in SVG, CSS, Canvas and DOM.
The homepage benchmark figures come from this repository's
`REPAIR-BENCHMARK-2026-09-13.md`, with the original caveats preserved.

## Local verification (2026-09-15)

- `node --test scripts/site.test.mjs`: 5/5 tests passed (static URLs/fragments,
  pair deck, snake movement/collision, food placement, circle/brick intersection).
- `node node_modules/typescript/bin/tsc`: passed; existing MCP code was not edited.
- Prettier checks for site HTML/CSS/JS, helper scripts and package.json: passed.
- HTTP preview: all 7 pages plus CSS/JS returned 200 under `/Wheel-mcp/`;
  `.env` and encoded backslash traversal probes returned 403.
- In-app browser: workflow selection, gallery filters, brick-breaker start and
  score progression, pause/resume, snake game-over and best-score persistence,
  memory card flips/step counting and restart were exercised.
- 390px viewport override: homepage and gallery had no horizontal overflow;
  memory-game mobile layout inspected. Viewport override reset afterwards.
- Not covered: full win-through of every game, real touchscreen devices,
  Safari/Firefox, actual Godot exports, or GitHub Pages deployment.
