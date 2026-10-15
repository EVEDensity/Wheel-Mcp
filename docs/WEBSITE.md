# Website / GitHub Pages

[Live showcase](https://evedensity.github.io/Wheel-Mcp/) · [Documentation index](README.md)

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

- `docs/index.html`: existing video hero, browser-only verification simulation,
  client selector, controlled benchmark summary and installation entry.
  Chinese is the default; the language button switches the landing-page copy.
- `site/sylva-nav.*` and `site/motion.*`: adapted navigation and section motion,
  including reduced-motion behavior. The navigation docks vertically while scrolling.
- `games/index.html`: filterable game gallery.
- `games/orbit-breaker/index.html`: original Canvas brick breaker.
- `games/circuit-snake/index.html`: original Canvas snake.
- `games/signal-match/index.html`: original DOM memory game.
- `games/godot-lab/index.html`: explicitly empty Godot Web slot.
- Documentation links go directly to the repository's Markdown documentation index.
- `site/`: shared styles and scripts.
- `assets/icons/`: published brand, AI client and Godot icons.
- `AGENT-COMPATIBILITY.md`: client matrix and the `npm.cmd run go:global` setup boundary.

The original demo games are **not** Godot exports, upstream games, MCP-generated
works or benchmark evidence. Their best scores use localStorage only; unavailable
storage does not prevent playing. Switching tabs pauses games. Canvas games are
visual games, not fully screen-reader-playable; the memory game has labeled
buttons and keyboard support. No audio is included.

## Preserve the showcase

Keep the current landing-page design rather than replacing it with a generated
documentation theme. Documentation links open GitHub-rendered Markdown, not raw
Markdown downloads on this no-Jekyll site. There is no separate HTML guide page.
The static browser simulation must remain distinct from actual engine evidence.
Gallery pages are Chinese-first; the landing-page language toggle does
not claim to translate every separate document or game.

## Add a Godot game

1. Verify Web export support for the exact engine and project language version.
2. Prefer the Compatibility renderer and disable thread support for basic Pages
   hosting. A threaded build needs cross-origin isolation headers; do not assume
   Pages provides them. This site installs no service worker workaround.
3. Put the **entire** export into `docs/games/godot-lab/web/`, including HTML, JS,
   WASM, PCK and all companion files. Retain their relative paths and filenames.
4. Test the export directly under the configured site base: locally
   `/Wheel-mcp/games/godot-lab/web/index.html`, currently on Pages
   `/Wheel-Mcp/docs/games/godot-lab/web/index.html`. Add a start link
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

The current public deployment uses **main / root**. Root `index.html` redirects
to `./docs/`; root `.nojekyll` disables Jekyll. The canonical entry to put in
GitHub About → Website is:

https://evedensity.github.io/Wheel-Mcp/

The showcase itself lives at https://evedensity.github.io/Wheel-Mcp/docs/.
Use the exact repository-path casing. Pushing site changes to main triggers the
existing Pages deployment; verify its result separately from the Node CI check.
No MCP server, credentials or local project files are hosted by the showcase.

If a maintainer deliberately changes Pages to **main /docs**, the public content
will instead be served directly at the project root. Do not change the source
just to publish documentation updates, or add a second Pages workflow alongside
the existing deployment. Keep assets and internal links relative.

The local `/Wheel-mcp/` prefix is a preview convention and is not the production
folder layout. Local HTTP success alone does not prove a deployment succeeded.

## Design references and primary hosting documentation

The early design used these developer-tool and game-showcase references.
The current site also contains adapted ThreeUI source and supplied media;
see [third-party notices](../THIRD-PARTY-NOTICES.md) for provenance and distribution scope.
Do not describe the entire site as wholly original or covered by the code's MIT license.

- Vite: https://vite.dev/ — clear developer-tool hero and feature narrative.
- Astro: https://astro.build/ — project showcase and structured exploration.
- Godot: https://godotengine.org/showcase/ — game-oriented showcase context.
- Godot Web exports:
  https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- GitHub Pages publishing source:
  https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

The small browser games are independent Canvas/DOM demonstrations.
The homepage benchmark figures come from this repository's
`REPAIR-BENCHMARK-2026-09-13.md`, with the original caveats preserved.

## Historical local verification (2026-09-15)

These results describe the earlier site snapshot, not acceptance of later edits.
For current changes run `npm run site:test` and check the affected pages in a browser.

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
