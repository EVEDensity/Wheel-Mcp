import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import aetherisLabsSource from "./sources/aetheris-labs.html?raw";
import audioWordmarkSource from "./sources/audio-wordmark.html?raw";
import dotBorderButtonSource from "./sources/dot-border-button.html?raw";
import creatorStudioIntroSource from "./sources/creator-studio-intro.html?raw";
import epiludeFooterSource from "./sources/epilude-footer.html?raw";
import expanseSource from "./sources/digital-expanse.html?raw";
import floatingDotsCtaSource from "./sources/floating-dots-cta.html?raw";
import galleryHeadingSource from "./sources/gallery-heading.html?raw";
import generateButtonSource from "./sources/generate-button.html?raw";
import glassmorphismCtaSource from "./sources/glassmorphism-cta.html?raw";
import gradientBeamCtaSource from "./sources/gradient-beam-cta.html?raw";
import gradientCtaSource from "./sources/gradient-cta.html?raw";
import gradientPillButtonSource from "./sources/gradient-pill-button.html?raw";
import ignitionSource from "./sources/ignition-terminal.html?raw";
import launchButtonSource from "./sources/launch-button.html?raw";
import starfieldSource from "./sources/imaginie-starfield.html?raw";
import tactileSource from "./sources/nexus-tactile.html?raw";
import topologySource from "./sources/nexus-topology.html?raw";
import recursiveErosionSource from "./sources/recursive-erosion.html?raw";
import slidingTextCtaSource from "./sources/sliding-text-cta.html?raw";
import spinningBorderButtonSource from "./sources/spinning-border-button.html?raw";
import thinkingSource from "./sources/thinking-button.html?raw";
import performanceGaugesSource from "./sources/performance-gauges.html?raw";
import logicCoreSource from "./sources/platform-core.html?raw";
import cloudSource from "./sources/strata-cloud.html?raw";
import particleOrbSource from "./sources/synthesis-orb.html?raw";
import inductionSource from "./sources/valence-core.html?raw";
import dimensionalSource from "./sources/vanguard-dimensional.html?raw";
import vertex9Source from "./sources/vertex-9.html?raw";
import voidFieldSource from "./sources/void-protocol.html?raw";

type FocusRole = "background" | "button" | "visual";
type EffectMode = "light" | "dark";

type FocusTarget = {
  selector: string;
  role: FocusRole;
  fit?: "cover" | "contain-square" | "wide-wordmark" | "portrait-stage";
  preserveTransform?: boolean;
};

type EffectDefinition = {
  title: string;
  source: string;
  background: string;
  targets: readonly FocusTarget[];
  theme?: {
    nativeMode?: EffectMode;
    lightBackground: string;
    darkBackground: string;
    invertBackground?: boolean;
  };
  transformSource?: (source: string, mode: EffectMode) => string;
  hiddenTargets?: readonly string[];
  introWordmark?: {
    sceneSelector: string;
    text: string;
    fontSize: number;
    endTime: number;
    holdTime: number;
    logoSvg: string;
  };
};

const THREEUI_MARK_SVG = `<svg viewBox="0 0 512 512" aria-hidden="true">
  <defs>
    <mask id="threeui-intro-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
      <rect width="512" height="512" fill="#000"/>
      <circle cx="256" cy="256" r="208" fill="#fff"/>
      <g fill="none" stroke="#000" stroke-linecap="round" stroke-width="28">
        <path d="M36 178C112 252 184 264 260 196C336 128 404 114 482 180"/>
        <path d="M36 292C112 366 184 378 260 310C336 242 404 228 482 294"/>
      </g>
    </mask>
  </defs>
  <rect width="512" height="512" fill="#f5f5f7" mask="url(#threeui-intro-cut)"/>
</svg>`;

const SHADERS_WORDMARK_SVG = `<svg width="1600" height="300" viewBox="0 0 1600 300" fill="none" xmlns="http://www.w3.org/2000/svg">
  <text x="800" y="235" text-anchor="middle" fill="#F4F4F0" font-family="'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="240" font-weight="900" letter-spacing="-8">SHADERS</text>
</svg>`;

export type NeuformIsolatedEffectProps = {
  mode?: EffectMode;
  hue?: number;
  saturation?: number;
  brightness?: number;
  className?: string;
  style?: CSSProperties;
};

export const NEUFORM_ISOLATED_DEFAULTS = {
  mode: "dark",
  hue: 0,
  saturation: 1,
  brightness: 1,
} as const;

/* ------------------------------------------------------------------ *
   The four galleries

   A variant is a different room, not another camera angle on one. Each
   brings its own orbit, its own twelve flat plate colours, the procedural
   field those plates are shaded with, the face the headline is set in, and
   the way the ring picks up speed when a pointer arrives.
 * ------------------------------------------------------------------ */
export const GALLERY_HEADING_VARIANTS = {
  /* matte — museum colours under one soft rise of noise, a light sans on
     wide tracking, and a ring that is sprung rather than eased */
  "rising-diagonal": {
    title: "Twelve Works in Slow Orbit",
    headline: ["TWELVE WORKS", "IN SLOW ORBIT"],
    headlineWidths: [1846, 2000],
    axis: 25.5,
    phase: 93,
    direction: 1,
    field: "matte",
    palette: [
      "#e9e5dd", "#20232a", "#c25a43", "#2f5b4e", "#d6cfc2", "#3a4763",
      "#dda45c", "#14161a", "#a7b3a4", "#f3f1ec", "#5a6670", "#8c4b3f",
    ],
    /* headline ink: [muted line, emphasis line, offset plate] */
    ink: { dark: ["#8d949c", "#ffffff", "#20232a"], light: ["#6b7280", "#111827", "#e9e5dd"] },
    type: { font: "sans", weight: "400", headlineSize: 1.15, tracking: 0.1 },
    motion: { spring: true, ease: 0.42 },
  },
  /* glitch — broadcast colours torn into flat blocks, rows out of register,
     and a bold sans that breaks up with them */
  "falling-diagonal": {
    title: "Signal Lost, Image Holding",
    headline: ["SIGNAL LOST", "IMAGE HOLDING"],
    headlineWidths: [1622, 1917],
    axis: -25.5,
    phase: 87,
    direction: -1,
    field: "glitch",
    palette: [
      "#0b0b12", "#ff2f6d", "#00e6ff", "#13f28a", "#f2f2f8", "#7a1bff",
      "#101018", "#ff7a1a", "#141a2e", "#e01f52", "#1a1a26", "#0ac2d8",
    ],
    /* headline ink: [muted line, emphasis line, offset plate] */
    ink: { dark: ["#ff2f6d", "#f2f2f8", "#0b0b12"], light: ["#c81049", "#111827", "#f2f2f8"] },
    type: { font: "sans", weight: "700", headlineSize: 1.2, tracking: 0 },
    motion: { spring: false, ease: 0.12 },
  },
  /* riso — print colours dithered to three tones over a lit corner, set in
     an old-style serif with a hard offset plate behind it */
  "horizontal-sweep": {
    title: "Prints from the Flat Files",
    headline: ["PRINTS FROM", "THE FLAT FILES"],
    headlineWidths: [1506, 1917],
    axis: 0,
    phase: 90,
    direction: 1,
    field: "riso",
    palette: [
      "#e0b64a", "#b1512a", "#6d7638", "#ecdfc2", "#2f6b66", "#8a3a2b",
      "#d69b3e", "#3c4630", "#c06e3a", "#e6d3a8", "#546d76", "#7a4726",
    ],
    /* headline ink: [muted line, emphasis line, offset plate] */
    ink: { dark: ["#e0b64a", "#f4e9d2", "#6d2a16"], light: ["#8a3a2b", "#2b2018", "#e0b64a"] },
    type: { font: "oldstyle", weight: "700", headlineSize: 1.2, tracking: 0.03 },
    motion: { spring: false, ease: 0.9 },
  },
  /* halftone — one ink on one stock, shaded only by dot size, under a high
     contrast didone */
  "vertical-loop": {
    title: "One Wall, Twelve Plates",
    headline: ["ONE WALL", "TWELVE PLATES"],
    headlineWidths: [1132, 1840],
    axis: 90,
    phase: 0,
    direction: -1,
    field: "halftone",
    palette: [
      "#12110f", "#f2efe8", "#1c1b18", "#e4e0d7", "#2b2a26", "#d6d1c6",
      "#0a0a09", "#faf8f3", "#1f1e1a", "#eae6dd", "#161513", "#c0402c",
    ],
    /* headline ink: [muted line, emphasis line, offset plate] */
    ink: { dark: ["#c0402c", "#f2efe8", "#12110f"], light: ["#c0402c", "#12110f", "#e4e0d7"] },
    type: { font: "didone", weight: "400", headlineSize: 1.25, tracking: 0.06 },
    motion: { spring: false, ease: 0.55 },
  },
} as const;

export type GalleryHeadingVariant = keyof typeof GALLERY_HEADING_VARIANTS;
type GalleryHeadingConfiguration = (typeof GALLERY_HEADING_VARIANTS)[GalleryHeadingVariant];

/* the four serif display stacks the headline can be set in; every one is a
   system face, so the sandboxed document needs no network to render */
export const GALLERY_HEADING_FONTS = {
  serif: '"Times New Roman",Times,"Liberation Serif","Nimbus Roman",serif',
  didone: 'Didot,"Bodoni 72","Bodoni MT","Playfair Display",Georgia,serif',
  oldstyle: '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif',
  sans: '"Helvetica Neue",Helvetica,"Inter",Arial,system-ui,sans-serif',
} as const;

export type GalleryHeadingFont = keyof typeof GALLERY_HEADING_FONTS;

export const GALLERY_HEADING_WEIGHTS = ["400", "700"] as const;
export type GalleryHeadingWeight = (typeof GALLERY_HEADING_WEIGHTS)[number];

/* font, weight, and headline size are per-variant; a caller that leaves them
   out gets the typography its gallery was drawn with, not a global default */
export const GALLERY_HEADING_DEFAULTS = {
  ...NEUFORM_ISOLATED_DEFAULTS,
  variant: "rising-diagonal",
} as const;

function transformThinkingButtonSource(source: string, mode: EffectMode) {
  const background = mode === "light" ? "#f4f7fb" : "#111318";
  const plate = mode === "light"
    ? ["#60a5fa", "#3b82f6", "#2563eb"]
    : ["#2563eb", "#1d4ed8", "#1e40af"];

  return source
    .replace("<title>Uploading — glowing border microinteraction</title>", "<title>Thinking — glowing border microinteraction</title>")
    .replace("<style>", '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300&display=swap" rel="stylesheet">\n<style>')
    .replaceAll("#1d1d1d", background)
    .replace("var word = 'Uploading'", "var word = 'Thinking'")
    .replace(
      'var FONT = \'300 100px -apple-system, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Inter, system-ui, "Segoe UI", Roboto, sans-serif\';',
      'var FONT = \'300 100px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif\';',
    )
    .replace(
      "      if(glyphs[i].ch === 'g') doubleStoreyG(c);\n      else{",
      "      {",
    )
    .replace("grd.addColorStop(0, '#2e3242');", `grd.addColorStop(0, '${plate[0]}');`)
    .replace("grd.addColorStop(0.55, '#2b2f3c');", `grd.addColorStop(0.55, '${plate[1]}');`)
    .replace("grd.addColorStop(1, '#272c36');", `grd.addColorStop(1, '${plate[2]}');`)
    .replaceAll("rgb(83,92,135)", "rgb(219,234,254)")
    .replaceAll("rgb(97,106,150)", "rgb(239,246,255)")
    .replace("rgb(133,141,189)", "rgb(255,255,255)")

    /* The recording framed one oversized hero button. SCL shrinks the whole
       composition — plate, track, comet widths, blur radii — down to a normal
       control, and the centre moves with it so the button stays in the middle. */
    .replace(
      "  var CX = 1024 - 22, CY = 1024 + 11.5;   /* button centre in the source recording */",
      "  var SCL = 0.49;                          /* hero button -> normal button */\n"
        + "  var CX = (1024 - 22)/SCL, CY = (1024 + 11.5)/SCL;",
    )
    .replace("    k = S*dpr/REF;", "    k = S*dpr/REF*SCL;")
    /* a touch wider than the source plate, to sit the spinner and the label side by side */
    .replace("  var PW = 976, PH = 345, PR = 100;", "  var PW = 1010, PH = 345, PR = 100;")
    /* the label drops well below a straight scale so it reads as button text */
    .replace(
      "  var TXT_W = 778, TXT_CAP = 120, TXT_BASE = 1093;",
      "  var TXT_W = 450, TXT_CAP = 79, TXT_BASE = CY + 38;\n"
        + "  var BR_R = 13, BR_SP = 40, BR_GAP = 78;   /* braille dot radius, cell pitch, gap to label */\n"
        + "  var BR_W = BR_SP + 2*BR_R, BR_SHIFT = (BR_W + BR_GAP)/2;\n"
        + "  /* the terminal 'dots' spinner, as raised-dot masks: bit 0..2 = left column top->bottom, 3..5 = right */\n"
        + "  var BRAILLE = [0x0B,0x19,0x39,0x38,0x3C,0x34,0x26,0x27,0x07,0x0F];\n"
        + "  var BR_STEPS = 30;                        /* three full spinner cycles per lap, so the loop still joins */",
    )
    .replace(
      "  var glyphs = [], fontPx = 169, tracking = 0, textX = 0;",
      "  var glyphs = [], fontPx = 169, tracking = 0, textX = 0, brailleX = 0;",
    )
    /* spinner + label are centred as one unit, so the label shifts right by half the spinner block */
    .replace(
      "    textX = (CX + 4)*k - TXT_W*k/2 + lead;",
      "    textX = (CX + 4)*k - TXT_W*k/2 + lead + BR_SHIFT*k;\n"
        + "    brailleX = (CX + 4)*k - (BR_W + BR_GAP + TXT_W)*k/2 + BR_R*k;",
    )
    .replace(
      "  function label(c, ph){",
      "  /* the spinner is drawn as dots rather than braille glyphs, so it never depends\n"
        + "     on a system face carrying the U+28xx block */\n"
        + "  function braille(c, ph){\n"
        + "    var mask = BRAILLE[Math.floor(ph*BR_STEPS) % BRAILLE.length];\n"
        + "    var cy = (CY - 1.5)*k, r = BR_R*k, sp = BR_SP*k;\n"
        + "    for(var b=0;b<6;b++){\n"
        + "      var on = (mask >> b) & 1;\n"
        + "      c.beginPath();\n"
        + "      c.arc(brailleX + (b < 3 ? 0 : sp), cy + ((b % 3) - 1)*sp, on ? r : r*0.7, 0, Math.PI*2);\n"
        + "      c.fillStyle = on ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.16)';\n"
        + "      c.fill();\n"
        + "    }\n"
        + "  }\n\n"
        + "  function label(c, ph){",
    )
    .replace("    plate(ctx);\n    label(ctx, ph);", "    plate(ctx);\n    braille(ctx, ph);\n    label(ctx, ph);");
}

/* ------------------------------------------------------------------ *
   Owner-selected button surfaces

   Both documents stay byte-for-byte exact. Each was authored against a
   single ground — the pill against white, the dot border against black —
   so the mode the preview is set to decides which one has to be re-toned.
   Geometry, elevation, hover choreography, and the masked metallic edge
   are left alone; only the values the other ground would swallow move.
 * ------------------------------------------------------------------ */

/* authored on white: over the dark ground the translucent black fill sinks
   below the backdrop and the 60% black label disappears entirely */
function transformGradientPillButtonSource(source: string, mode: EffectMode) {
  if (mode !== "dark") return source;

  return source
    /* the concave metallic fill, mirrored — bright at the edges, dim through
       the middle, so the pill still reads as a curved plate rather than a hole */
    .replace("from-black/10 via-black/20 to-black/10", "from-white/[0.16] via-white/[0.07] to-white/[0.16]")
    .replace("text-black/60", "text-white/70")
    .replace("text-slate-600", "text-slate-200")
    .replace('stroke="#666"', 'stroke="#e5e7eb"')
    /* the hover fill sits behind the gradient, so near-white flashed the pill */
    .replace("hover:bg-slate-50", "hover:bg-white/10");
}

/* authored on black: dots, dashes, hatch, border, label, and arrow are all
   white at low alpha, so on the light ground nothing shows until hover */
function transformDotBorderButtonSource(source: string, mode: EffectMode) {
  if (mode !== "light") return source;

  return source
    .replaceAll("#fffa", "#111a")   /* corner dots, dashed border, hovered arrow stroke */
    .replaceAll("#fffd", "#111d")   /* label */
    .replaceAll("#fff4", "#1114")   /* resting arrow stroke */
    .replaceAll("#fff3", "#1113")   /* diagonal hatch, button border, hovered arrow fill */
    .replaceAll("#fff2", "#1112");  /* resting arrow fill */
}

/* ------------------------------------------------------------------ *
   Gallery Heading

   The packaged document stays byte-for-byte exact. The rewrite below turns
   the authored launch poster into a gallery heading: the small corner marks
   and the two flanking notes are dropped, the two-line headline is scaled
   about the block centre the author composed it on, the twelve ring tiles
   are cropped to 4:3, and the ring rests until a pointer is over it.

   It also replaces the subject. The authored tiles were eleven grainy
   gradient wallpapers, and this is a gallery rather than a gradient
   showcase — so every tile becomes one flat colour shaded by a procedural
   noise field, and each variant runs its own field, its own typography, and
   its own way of coming up to speed.

   Font, weight, and headline size arrive by postMessage rather than by a
   document rebuild, because rebuilding a srcDoc iframe would regenerate all
   twelve 512px tile textures on every control tick.
 * ------------------------------------------------------------------ */

/* the authored small-label builder, replaced wholesale by an empty layer */
const GALLERY_HEADING_LABEL_BLOCK = /function buildLabels\(\)\{[\s\S]*?\n\}\n\nfunction resize/;

/* the authored headline builder, replaced by the per-variant one */
const GALLERY_HEADING_HEAD_BLOCK = /function buildHead\(\)\{[\s\S]*?\n\}\n\nfunction buildLabels/;

/* the gradient wallpapers and every helper that painted them */
const GALLERY_HEADING_ART_BLOCK = /function lin\(x,x0,y0,x1,y1,stops\)\{[\s\S]*?\n\];\n\nfunction roundRectPath/;

/* the authored film grain, now laid by each field painter at its own weight */
const GALLERY_HEADING_GRAIN_BLOCK = /    \/\* film grain \*\/\n[\s\S]*?\n    x\.restore\(\);\n    front\.push\(c\);/;

/* the authored clock, replaced by the hover-driven one */
const GALLERY_HEADING_CLOCK_BLOCK = /var t0 = performance\.now\(\), tNow = 0, playing = true;[\s\S]*?window\.__play = function\(\)\{ t0 = performance\.now\(\) - tNow\*1000; playing = true; \};/;

/* the headline, set once per variant: an optional hard offset plate under
   the ink for riso, an optional channel break-up over it for glitch, and
   tracking that the fitted width absorbs so the letterforms stay proportional */
const GALLERY_HEADING_HEAD = `function buildHead(){
  headLayer = mkc(Math.max(1,W), Math.max(1,H));
  var x = headLayer.getContext('2d');
  if (x.letterSpacing !== undefined) x.letterSpacing = (HEAD_TRACK*HEAD_CAP*HEAD_SIZE*K).toFixed(2)+'px';
  if (HEAD_STYLE === 'riso'){
    var off = 0.055*HEAD_CAP*HEAD_SIZE*K;
    headPass(x, off, off, HEAD_SHADOW);
  }
  headPass(x, 0, 0, null);
  if (HEAD_STYLE === 'glitch') headGlitch(x);
}

/* one setting of the two headline lines, optionally displaced and forced to
   a single colour, so a style can stack passes into its treatment */
function headPass(x, dx, dy, tint){
  for (var i=0;i<HEAD.length;i++){
    var h = HEAD[i];
    fitText(x, h.s, SANS, HEAD_WEIGHT, HEAD_CAP*HEAD_SIZE*K, d2sx(1481) + dx,
            d2sy(HEAD_MID + (h.top - HEAD_MID)*HEAD_SIZE) + dy, h.w*HEAD_SIZE*K, tint || h.fill);
  }
}

/* the headline as a picture that lost its signal: a few rows slip sideways
   and two colour channels sit out of register behind the letterforms */
function headGlitch(x){
  var w = headLayer.width, h = headLayer.height, i;
  var snap = mkc(w,h);
  snap.getContext('2d').drawImage(headLayer,0,0);
  var r = rng(0x2E51);
  var top = d2sy(HEAD_MID) - HEAD_CAP*HEAD_SIZE*K*2.1, span = HEAD_CAP*HEAD_SIZE*K*4.2;
  for (i=0;i<7;i++){
    var sy = Math.round(top + r()*span);
    var sh = Math.round((0.03 + r()*0.11)*HEAD_CAP*HEAD_SIZE*K);
    var dx = Math.round((r()-0.5)*0.08*w);
    x.clearRect(0,sy,w,sh);
    x.drawImage(snap, 0,sy,w,sh, dx,sy,w,sh);
  }
  var ghost = function(color){
    var g = mkc(w,h), gx = g.getContext('2d');
    gx.drawImage(snap,0,0);
    gx.globalCompositeOperation = 'source-in';
    gx.fillStyle = color; gx.fillRect(0,0,w,h);
    return g;
  };
  var off = 0.05*HEAD_CAP*HEAD_SIZE*K;
  x.save();
  /* the ghosts go under the letterforms, so the headline stays readable */
  x.globalCompositeOperation = 'destination-over';
  x.globalAlpha = 0.9;
  x.drawImage(ghost(HEAD_GHOST[0]), -off, 0);
  x.drawImage(ghost(HEAD_GHOST[1]), off, 0);
  x.restore();
}

function buildLabels`;

/* twelve flat plates and the four fields that shade them */
const GALLERY_HEADING_ART = `function fill(x,style){ x.fillStyle = style; x.fillRect(0,0,TS,TS); }

function rgbOf(hex){
  var v = parseInt(hex.slice(1),16);
  return [(v>>16)&255,(v>>8)&255,v&255];
}
function mixRGB(a,b,t){
  return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
}
function cssRGB(c){
  return 'rgb('+(c[0]|0)+','+(c[1]|0)+','+(c[2]|0)+')';
}
function luma(c){ return (c[0]*0.299 + c[1]*0.587 + c[2]*0.114)/255; }

/* value noise on a 64x64 lattice, smoothstep-interpolated and wrapped */
function noiseField(seed){
  var g = new Float32Array(4096), r = rng(seed), i;
  for (i=0;i<4096;i++) g[i] = r();
  return function(x,y){
    var x0 = Math.floor(x), y0 = Math.floor(y);
    var fx = x - x0, fy = y - y0;
    fx = fx*fx*(3-2*fx); fy = fy*fy*(3-2*fy);
    var ra = (y0 & 63)*64, rb = ((y0+1) & 63)*64, ca = x0 & 63, cb = (x0+1) & 63;
    var a = g[ra+ca], b = g[ra+cb], c = g[rb+ca], d = g[rb+cb];
    return a + (b-a)*fx + (c-a)*fy + (a-b-c+d)*fx*fy;
  };
}
function fbm(n,x,y,oct){
  var v = 0, amp = 0.5, f = 1, tot = 0, i;
  for (i=0;i<oct;i++){ v += amp*n(x*f,y*f); tot += amp; amp *= 0.5; f *= 2; }
  return v/tot;
}
function grain(x, alpha){
  x.save();
  x.globalCompositeOperation = 'overlay';
  x.globalAlpha = alpha;
  x.fillStyle = x.createPattern(grainTile,'repeat');
  x.fillRect(0,0,TS,TS);
  x.restore();
}

/* paint a low-resolution field, then blow it up over the whole tile: smooth
   for a matte plate, nearest wherever the noise has to keep its edges */
function fieldBuffer(N, shade){
  var buf = mkc(N,N), bx = buf.getContext('2d'), d = bx.createImageData(N,N), px, py, o, c;
  for (py=0;py<N;py++){
    for (px=0;px<N;px++){
      c = shade((px+0.5)/N, (py+0.5)/N, px, py);
      o = (py*N+px)*4;
      d.data[o] = c[0]|0; d.data[o+1] = c[1]|0; d.data[o+2] = c[2]|0;
      d.data[o+3] = c.length > 3 ? c[3]|0 : 255;
    }
  }
  bx.putImageData(d,0,0);
  return buf;
}
function blowUp(x, buf, smooth, alpha){
  x.save();
  x.imageSmoothingEnabled = smooth;
  if (alpha !== undefined) x.globalAlpha = alpha;
  x.drawImage(buf, 0, 0, TS, TS);
  x.restore();
}

/* matte — a museum plate: flat colour, one slow rise of noise across it,
   and grain fine enough to read as the surface rather than as an effect */
function paintMatte(x, base, i){
  var n = noiseField(0x2C41 + i*9176);
  var hi = mixRGB(base,[255,255,255],0.13), lo = mixRGB(base,[0,0,0],0.15);
  blowUp(x, fieldBuffer(160, function(u,v){
    var s = 0.5 + (fbm(n, u*6.5, v*6.5, 5) - 0.5)*1.9 + (v - 0.5)*0.07;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    return s < 0.5 ? mixRGB(lo, base, s*2) : mixRGB(base, hi, (s-0.5)*2);
  }), true);
  grain(x, 0.1);
}

/* glitch — a plate that lost the signal: flat blocks torn out of the
   neighbouring colours, rows slipped sideways, two channels off register */
function paintGlitch(x, base, i){
  var r = rng(0x51B7 + i*30011), k;
  fill(x, cssRGB(base));
  for (k=0;k<4;k++){
    x.fillStyle = cssRGB(rgbOf(PLATES[(i + 1 + ((r()*5)|0)) % PLATES.length]));
    x.fillRect(Math.round((r()-0.2)*TS), Math.round(r()*TS),
               Math.round((0.2 + r()*0.55)*TS), Math.round((0.04 + r()*0.2)*TS));
  }
  blowUp(x, fieldBuffer(64, function(){
    var w = r() < 0.5 ? 250 : 6;
    return [w,w,w, r() < 0.2 ? 200 : 0];
  }), false, 0.5);
  /* rows slip sideways, each one wrapped so no edge is ever left empty */
  var snap = mkc(TS,TS);
  snap.getContext('2d').drawImage(x.canvas,0,0);
  for (k=0;k<11;k++){
    var y0 = Math.round(r()*TS), h = Math.round((0.01 + r()*0.06)*TS);
    var dx = Math.round((r()-0.5)*0.36*TS);
    x.clearRect(0,y0,TS,h);
    x.drawImage(snap, 0,y0,TS,h, dx,y0,TS,h);
    x.drawImage(snap, 0,y0,TS,h, dx + (dx < 0 ? TS : -TS),y0,TS,h);
  }
  var channel = function(color){
    var g = mkc(TS,TS), gx = g.getContext('2d');
    gx.drawImage(x.canvas,0,0);
    gx.globalCompositeOperation = 'multiply';
    gx.fillStyle = color; gx.fillRect(0,0,TS,TS);
    return g;
  };
  var red = channel('#ff3050'), cyan = channel('#30e0ff');
  x.save();
  x.globalCompositeOperation = 'lighter';
  x.globalAlpha = 0.3;
  x.drawImage(red, -0.022*TS, 0);
  x.drawImage(cyan, 0.022*TS, 0);
  x.restore();
  x.save();
  x.fillStyle = 'rgba(0,0,0,0.22)';
  for (k=0;k<TS;k+=4) x.fillRect(0,k,TS,1);
  x.restore();
  grain(x, 0.24);
}

/* riso — the printed plate: a lit corner and a noise field quantised to
   three tones through an ordered dither, then scanlines and heavy grain */
var BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
function paintRiso(x, base, i){
  var n = noiseField(0x77A3 + i*15731), k;
  var lo = mixRGB(base,[24,14,6],0.66), hi = mixRGB(base,[255,238,196],0.5);
  var cx = 0.22 + (i % 3)*0.28, cy = 0.2 + ((i/3)|0)*0.2;
  blowUp(x, fieldBuffer(100, function(u,v,px,py){
    var d = Math.sqrt((u-cx)*(u-cx) + (v-cy)*(v-cy));
    var s = (1 - d*1.25)*0.72 + fbm(n, u*3.2, v*3.2, 3)*0.52 - 0.1;
    var band = Math.floor(s*2.4 + (BAYER[(py & 3)*4 + (px & 3)] + 0.5)/16);
    return band <= 0 ? lo : band === 1 ? base : hi;
  }), false);
  x.save();
  x.fillStyle = 'rgba(28,14,4,0.18)';
  for (k=0;k<TS;k+=6) x.fillRect(0,k,TS,2);
  x.restore();
  grain(x, 0.22);
}

/* halftone — one ink on one stock, shaded only by the size of the dots on
   a screen rotated a few degrees further for every tile */
function paintHalftone(x, base, i){
  var n = noiseField(0x3F19 + i*21467), gx, gy;
  fill(x, cssRGB(base));
  var dot = luma(base) > 0.5 ? mixRGB(base,[0,0,0],0.88) : mixRGB(base,[255,255,255],0.9);
  var pitch = TS/30, a = (17 + (i % 4)*9)*Math.PI/180;
  var ca = Math.cos(a), sa = Math.sin(a), span = Math.ceil(TS/pitch);
  x.save();
  x.fillStyle = cssRGB(dot);
  x.translate(TS/2, TS/2);
  x.rotate(a);
  for (gy=-span;gy<=span;gy++){
    for (gx=-span;gx<=span;gx++){
      var wx = gx*pitch, wy = gy*pitch;
      var u = (wx*ca - wy*sa)/TS + 0.5, v = (wx*sa + wy*ca)/TS + 0.5;
      if (u < -0.1 || u > 1.1 || v < -0.1 || v > 1.1) continue;
      var s = fbm(n, u*2.7, v*2.7, 4)*0.95 + (0.55 - v)*0.5;
      var rad = pitch*0.66*(s < 0 ? 0 : s > 1 ? 1 : s);
      if (rad < 0.4) continue;
      x.beginPath(); x.arc(wx, wy, rad, 0, Math.PI*2); x.fill();
    }
  }
  x.restore();
  grain(x, 0.12);
}

var PAINTERS = { matte: paintMatte, glitch: paintGlitch, riso: paintRiso, halftone: paintHalftone };
var ART = (function(){
  var painter = PAINTERS[FIELD] || paintMatte, list = [], i;
  for (i=0;i<PLATES.length;i++){
    list.push((function(index){
      return function(x){ painter(x, rgbOf(PLATES[index]), index); };
    })(i));
  }
  return list;
})();

function roundRectPath`;

/* the ring rests at a standstill and only orbits while a pointer is over it,
   easing up and back down so hovering in and out never snaps; the matte
   gallery is sprung instead, overshooting into motion and rocking once as it
   settles. The same block carries the live control channel, since both need
   the render loop's state.

   The document sees the pointer arrive reliably, but a sandboxed cross-process
   frame is not guaranteed the matching leave — so the host watches for that
   edge and posts it in, and the two signals together decide the state. */
const GALLERY_HEADING_CLOCK = `var tNow = 0, playing = true, hovering = false, rate = 0, vel = 0, settled = false, last = performance.now();

function setHover(state){
  if (hovering === state) return;
  hovering = state; settled = false;
  /* the host cannot see the pointer arrive over this frame, so tell it — it is
     the one that will see the pointer leave again */
  if (state && window.parent !== window){
    try { window.parent.postMessage({ threeuiPointerOver: true }, '*'); } catch (error) {}
  }
}
var root = document.documentElement;
root.addEventListener('pointerenter', function(){ setHover(true); });
root.addEventListener('pointermove',  function(){ setHover(true); });
root.addEventListener('pointerdown',  function(){ setHover(true); });
root.addEventListener('pointerleave', function(){ setHover(false); });
root.addEventListener('pointercancel',function(){ setHover(false); });
window.addEventListener('blur', function(){ setHover(false); });

function frame(now){
  var dt = Math.min(0.05, Math.max(0, (now - last)/1000));
  last = now;
  if (playing){
    if (SPRING){
      vel += (((hovering ? 1 : 0) - rate)*SPRING_K - vel*SPRING_D)*dt;
      rate += vel*dt;
    } else {
      rate += ((hovering ? 1 : 0) - rate) * (1 - Math.exp(-dt/EASE));
    }
    if (Math.abs(rate) > 0.0004 || Math.abs(vel) > 0.0004){
      tNow = ((tNow + dt*rate) % DUR + DUR) % DUR;
      render(tNow); settled = false;
    } else if (!settled){
      rate = 0; vel = 0; render(tNow); settled = true;
    }
  }
  requestAnimationFrame(frame);
}

/* font family, weight, and headline size arrive live so a control tick never
   rebuilds the document and repaints the twelve tile textures */
window.addEventListener('message', function(event){
  var runtime = event.data && event.data.threeuiRuntime;
  if (!runtime) return;
  if (typeof runtime.font === 'string') SANS = runtime.font;
  if (typeof runtime.weight === 'string') HEAD_WEIGHT = runtime.weight;
  if (typeof runtime.headlineSize === 'number' && runtime.headlineSize > 0){
    HEAD_SIZE = Math.max(0.6, Math.min(1.8, runtime.headlineSize));
  }
  if (typeof runtime.hover === 'number') setHover(runtime.hover > 0);
  buildHead(); settled = false; render(tNow);
});

window.addEventListener('resize', function(){ resize(); settled = false; render(tNow); });
resize();
render(tNow);
requestAnimationFrame(frame);

window.__DUR = DUR;
window.__seek = function(t){
  tNow = ((t % DUR) + DUR) % DUR;
  playing = false;
  render(tNow);
};
window.__play = function(){ last = performance.now(); playing = true; settled = false; };`;

function transformGalleryHeadingSource(
  source: string,
  mode: EffectMode,
  variant: GalleryHeadingConfiguration,
) {
  const background = mode === "light" ? "#f4f7fb" : "#000000";
  const ink = mode === "light" ? variant.ink.light : variant.ink.dark;
  const font = GALLERY_HEADING_FONTS[variant.type.font];

  return source
    .replace("<title>New Grainient Collection Added — motion</title>", `<title>${variant.title} — motion</title>`)
    .replace("html,body{margin:0;height:100%;background:#000;overflow:hidden}", `html,body{margin:0;height:100%;background:${background};overflow:hidden}`)
    .replace("axis: 25.5,", `axis: ${variant.axis},`)
    .replace("phase: 93", `phase: ${variant.phase}`)

    /* 4:3 tiles: the tile keeps its authored width and the ring plane is where
       the crop happens, so the square texture is covered, never squashed */
    .replace(
      "  tile: 346,            /* tile side in ring units (R = a)               */",
      "  tile: 346,            /* tile width in ring units (R = a)              */\n"
        + "  aspect: 0.75,         /* tile height / width — a 4:3 landscape crop    */",
    )
    .replace(
      "  roundRectPath(ctx, TS, TS, TS*RING.radius);",
      "  roundRectPath(ctx, TS, TS*RING.aspect, TS*RING.aspect*RING.radius);",
    )

    /* the headline is the whole composition now, so it carries the variant's
       face, weight, tracking, and treatment, and scales about HEAD_MID — the
       vertical centre of the authored two-line block */
    .replace(
      "var CAP = 142;          /* headline cap height */\nvar SMALL = 22;         /* small-label cap height */",
      `var HEAD_CAP = 142;     /* authored headline cap height */\n`
        + `var HEAD_MID = 1093;    /* authored vertical centre of the two-line block */\n`
        + `var HEAD_SIZE = ${variant.type.headlineSize};   /* headline size multiplier */\n`
        + `var HEAD_WEIGHT = '${variant.type.weight}'; /* headline weight */\n`
        + `var HEAD_TRACK = ${variant.type.tracking};   /* headline tracking, in cap heights */\n`
        + `var HEAD_STYLE = '${variant.field}';\n`
        + `var HEAD_SHADOW = '${ink[2]}';  /* riso: the plate under the ink */\n`
        + `var HEAD_GHOST = ['#ff2f6d','#00e6ff'];  /* glitch: the two channel ghosts */\n`
        + `var PLATES = ${JSON.stringify(variant.palette)};\n`
        + `var FIELD = '${variant.field}';       /* which painter shades the plates */\n`
        + `var EASE = ${variant.motion.ease};        /* seconds for the orbit to reach hover speed */\n`
        + `var SPRING = ${variant.motion.spring ? 1 : 0}, SPRING_K = 26, SPRING_D = 5.7;`,
    )
    .replace(
      "var SANS = '\"Helvetica Neue\",Helvetica,\"Inter\",Arial,system-ui,sans-serif';",
      `var SANS = '${font}';`,
    )
    .replace("{ s:'NEW GRAINIENT',    top:930,  w:1370, fill:'#d0d0d0' }", `{ s:'${variant.headline[0]}', top:930,  w:${variant.headlineWidths[0]}, fill:'${ink[0]}' }`)
    .replace("{ s:'COLLECTION ADDED', top:1114, w:1775, fill:'#ffffff' }", `{ s:'${variant.headline[1]}', top:1114, w:${variant.headlineWidths[1]}, fill:'${ink[1]}' }`)
    .replace(" * Tile artwork — eleven grainy gradient \"wallpapers\"", " * Tile artwork — twelve flat plates under a procedural noise field")
    .replace(GALLERY_HEADING_ART_BLOCK, GALLERY_HEADING_ART)
    .replace(GALLERY_HEADING_GRAIN_BLOCK, "    /* each field painter lays its own grain, at the weight its style wants */\n    front.push(c);")

    /* the authored reverse side crushed a gradient to a hint; a flat plate has
       less to give up, so the far half of the ring keeps more of its colour */
    .replace("y.fillStyle = 'rgba(6,8,18,0.75)';", "y.fillStyle = 'rgba(10,12,24,0.45)';")
    .replace(GALLERY_HEADING_HEAD_BLOCK, GALLERY_HEADING_HEAD)
    .replace(
      GALLERY_HEADING_LABEL_BLOCK,
      "function buildLabels(){\n"
        + "  /* the launch poster's corner marks and flanking notes are dropped; the\n"
        + "     layer stays so the compositing order below is untouched */\n"
        + "  labelLayer = mkc(1,1);\n"
        + "}\n\nfunction resize",
    )

    .replace("var spin = (t/DUR)*Math.PI*2;", `var spin = (t/DUR)*Math.PI*2*${variant.direction};`)
    .replace("ctx.fillStyle = '#000';\n  ctx.fillRect(0,0,W,H);", `ctx.fillStyle = '${background}';\n  ctx.fillRect(0,0,W,H);`)

    .replace(GALLERY_HEADING_CLOCK_BLOCK, GALLERY_HEADING_CLOCK);
}

/* ------------------------------------------------------------------ *
   Recursive Erosion styles

   The packaged document stays byte-for-byte exact. Each style is a runtime
   rewrite of the authored blocks that decide the subject — where the lattice
   points sit, where the glowing ropes ride, how the vertex shader shapes and
   erodes a point, and which palette it is tinted with — so the same erosion,
   trail, grain, chromatic fringe, and seamless-loop machinery drives a
   lightning sphere, a branch structure, a mountain range, or a nebula.

   Every rewrite also carries the host-control channel: speed, point size, and
   wavelength arrive by postMessage and the pointer is read inside the
   document, because a srcDoc iframe cannot take a live prop without being
   rebuilt, and rebuilding it would restart the loop on every slider tick.
 * ------------------------------------------------------------------ */

const RECURSIVE_EROSION_POINT_BLOCK = /  var GA=Math\.PI\*\(3-Math\.sqrt\(5\)\), SP=Math\.sqrt\(4\*Math\.PI\/N\);[\s\S]*?(?=  var A=\{dir:)/;
const RECURSIVE_EROSION_PATH_BLOCK = /  var W=\[\];[\s\S]*?(?=  var tmpA=)/;
const RECURSIVE_EROSION_SHAPE_BLOCK = /'  vec3 dir=a_dir;',[\s\S]*?'  float face=smoothstep\(-0\.10,0\.06,n\.z\);',/;
const RECURSIVE_EROSION_ROTATION_BLOCK = /    var ax=0\.22\*Math\.sin\(th\)\+0\.06\*Math\.sin\(th\*2\+1\.1\);\n    var ay=0\.30\*Math\.sin\(th\+2\.2\)\+0\.08\*Math\.cos\(th\*2\);\n    var az=0\.10\*Math\.cos\(th\+0\.6\);/;

/* the two authored flicker envelopes, one for the lattice halo and one for the
   rope itself — a style that replaces them replaces both with the same term */
const RECURSIVE_EROSION_HALO_FLICKER = "      var flick=0.76+0.24*Math.sin(th*2.0+w.fl);";
const RECURSIVE_EROSION_ROPE_FLICKER = "      var flick=0.86+0.14*Math.sin(th*2.0+w.fl);";

type RecursiveErosionStyle = {
  title: string;
  screenReaderCopy: string;
  duration: string;
  lattice: string;
  ropes: string;
  pearls: string;
  scale: string;
  dotSize: string;
  threshold: string;
  wormFalloff: string;
  dotProfile: string;
  /* omitted when the style keeps the authored fibonacci lattice */
  points?: string;
  paths: string;
  shape: string;
  palette: readonly [string, string, string];
  tint: string;
  rotation: string;
  grain: string;
  /* only styles that answer the pointer replace these two */
  pointerBoost?: string;
  projection?: string;
  /* only styles that strike rather than crawl replace the flicker envelope */
  flicker?: string;
  lightBackground: string;
  darkBackground: string;
};

const RECURSIVE_EROSION_SPHERE: RecursiveErosionStyle = {
  title: "Recursive Erosion — Lightning Sphere Motion Study",
  screenReaderCopy: "A four-second looping study of a generative particle sphere: a dense lattice of small orange dots over a transparent backdrop, its surface crumpling and eroding into holes while jagged lightning arcs strike across it, and the shell leaning out toward the pointer wherever the cursor rests, each dot fringed with red and blue chromatic aberration.",
  duration: "  var DUR=3.99;                 /* reference loop length */",
  lattice: "  var N=7000;                   /* lattice points */",
  ropes: "  var WORMS=8, TAIL=12, WN=WORMS*TAIL;",
  pearls: "  var PEARL=44, TN=WORMS*PEARL, TSTRIDE=5;",
  scale: "    gl.uniform2f(U.u_scale,0.672*aspX,0.672*aspY);",
  dotSize: "    gl.uniform1f(U.u_px,Math.max(1.0,size/1080*6.4*PSIZE));",
  threshold: "    gl.uniform1f(U.u_thr,0.19+0.04*Math.sin(th*2+0.8));",
  wormFalloff: "  '      boost+=u_worm[i].w*exp(-dot(d,d)*160.0);',",
  dotProfile: "  '  v_k=(u_pass>0.5)?3.0:(u_trail>0.5?0.0:2.1);',",
  paths: `  var W=[], TWO=6.283185307179586;
  for(i=0;i<WORMS;i++){
    /* each strike still rides a tilted great circle centred on the viewer-facing
       side, so a steady handful of arcs is always on screen */
    var cz=0.06+R0()*0.86, ca0=R0()*TWO, cr=Math.sqrt(Math.max(0,1-cz*cz));
    var c=[Math.cos(ca0)*cr,Math.sin(ca0)*cr,cz];
    var t0=Math.abs(c[1])<0.85?[0,1,0]:[1,0,0];
    var d=t0[0]*c[0]+t0[1]*c[1]+t0[2]*c[2];
    var u=[t0[0]-c[0]*d,t0[1]-c[1]*d,t0[2]-c[2]*d];
    var lu=Math.hypot(u[0],u[1],u[2]); u=[u[0]/lu,u[1]/lu,u[2]/lu];
    var v=[c[1]*u[2]-c[2]*u[1],c[2]*u[0]-c[0]*u[2],c[0]*u[1]-c[1]*u[0]];
    var rho=0.46+R0()*0.42, sr=Math.sin(rho), crho=Math.cos(rho);
    var mm=1+Math.floor(R0()*2);
    /* the kink pattern has to close over the loop, so a whole number of kinks
       per revolution is chosen first and the frequency derived from it */
    var kper=Math.max(6,Math.round(4.6*TWO*mm));
    W.push({c:c,u:u,v:v,sr:sr,cr:crho,m:mm,ph:R0()*TWO,
            str:1.35+R0()*0.45,arc:(1.45+R0()*0.60)/sr,fl:R0()*TWO,
            seed:1+R0()*97,kper:kper,zq:kper/(TWO*mm),
            rate:2+Math.floor(R0()*4),ph0:R0(),
            /* one discharge: near-instant attack, exponential decay, and a
               stutter down the tail. That envelope is what reads as lightning
               instead of as a rope crawling steadily over the shell. */
            env:function(t){
              var f=(t/TWO)*this.rate+this.ph0; f-=Math.floor(f);
              var e=Math.exp(-f*4.4)*(0.58+0.42*Math.sin(f*88.0+this.fl));
              return e>0?e:0;
            }});
  }
  /* a fixed hash, so every kink of an arc stays put instead of boiling */
  function zig(seed,k){
    var x=Math.sin(seed*127.1+k*311.7)*43758.5453;
    return (x-Math.floor(x))*2-1;
  }
  /* a point on strike k's arc at angle ang, written into out[] — the great
     circle carries a piecewise-linear kink pattern, and that is what turns the
     authored smooth rope into a forked bolt */
  function onPath(w,ang,out){
    var s=ang*w.zq+w.seed, ki=Math.floor(s), f=s-ki;
    var e=f*f*(3-2*f), pp=w.kper;
    var k0=((ki%pp)+pp)%pp, k1=(((ki+1)%pp)+pp)%pp;
    var off=(zig(w.seed,k0)*(1-e)+zig(w.seed,k1)*e)*0.105;
    var tw=(zig(w.seed+7.3,k0)*(1-e)+zig(w.seed+7.3,k1)*e)*0.065;
    var a2=ang+tw, ca=Math.cos(a2), sa=Math.sin(a2), rr=w.sr+off;
    out[0]=w.c[0]*w.cr+(w.u[0]*ca+w.v[0]*sa)*rr;
    out[1]=w.c[1]*w.cr+(w.u[1]*ca+w.v[1]*sa)*rr;
    out[2]=w.c[2]*w.cr+(w.u[2]*ca+w.v[2]*sa)*rr;
  }
`,
  shape: `'  vec3 dir=a_dir;',
  '  vec2 c=vec2(cos(u_th),sin(u_th));',
  /* every noise lookup rides a closed circular path, so the morph is exactly
     periodic; the wavelength control scales all of them together */
  '  float iw=1.0/u_wave;',
  '  float n1=snoise(dir*(1.30*iw)+vec3(c*0.95,0.0));',
  '  float n2=snoise(dir*(2.70*iw)+vec3(0.0,c*0.80));',
  '  float n3=snoise(dir*(5.60*iw)+vec3(c.y*0.62,0.0,c.x*0.62));',
  '  float ridge=1.0-abs(n2);',
  '  float disp=0.54*n1+0.44*(ridge-0.5)+0.20*n3;',
  '  float R=1.0+0.305*disp;',
  /* recursive erosion: two scales of noise chew holes through the shell */
  '  float e=0.66*snoise(dir*(1.45*iw)+vec3(c*1.30,0.4))+0.34*snoise(dir*(3.10*iw)+vec3(0.3,c*1.05));',
  '  float alive=smoothstep(u_thr-0.05,u_thr+0.06,e+0.5);',
  '  vec3 n=u_rot*dir;',
  /* pointer attraction: the resting point is projected into the same clip space
     the pointer is reported in, then a gaussian around the cursor lifts the
     shell along its own radius and drags it toward the cursor at projection */
  '  vec3 rest=u_rot*(dir*R);',
  '  vec2 toP=u_ptr.xy-(rest.xy*(1.0/(1.0-0.14*rest.z))*u_scale+u_off);',
  '  float pull=u_ptr.z*exp(-dot(toP,toP)*22.0)*smoothstep(-0.30,0.22,n.z);',
  '  vec3 p=u_rot*(dir*(R+0.22*pull));',
  '  float persp=1.0/(1.0-0.14*p.z);',
  '  float face=smoothstep(-0.10,0.06,n.z);',`,
  palette: [
    "  '  vec3 cDim=vec3(0.94,0.33,0.05);',",
    "  '  vec3 cMid=vec3(1.00,0.56,0.16);',",
    "  '  vec3 cHot=vec3(1.00,0.90,0.72);',",
  ],
  tint: "  '  vec3 col=mix(cDim,cMid,a_rand.x*a_rand.x);',",
  rotation: `    var ax=0.22*Math.sin(th)+0.06*Math.sin(th*2+1.1);
    var ay=0.30*Math.sin(th+2.2)+0.08*Math.cos(th*2);
    var az=0.10*Math.cos(th+0.6);`,
  grain: "        d[i]=n; d[i+1]=n*0.74; d[i+2]=n*0.52; d[i+3]=255;",
  pointerBoost: "  '    boost=min(boost+pull*0.85,1.5);',",
  projection: "  '  gl_Position=vec4(p.xy*persp*u_scale+u_off+toP*(pull*0.26),0.0,1.0);',",
  flicker: "      var flick=w.env(th);",
  lightBackground: "#f4f3f1",
  darkBackground: "#0a0908",
};

const RECURSIVE_EROSION_BRANCHES: RecursiveErosionStyle = {
  title: "Recursive Erosion — Branch Growth Motion Study",
  screenReaderCopy: "A looping study of a generative branch structure: a dendritic lattice of small amber dots over a transparent backdrop, its limbs swaying and eroding back from the tips while bright glowing pulses climb from the root out to each branch tip, each dot fringed with red and blue chromatic aberration.",
  duration: "  var DUR=9.0;                  /* reference loop length */",
  lattice: "  var N=4200;                   /* lattice points */",
  ropes: "  var WORMS=8, TAIL=12, WN=WORMS*TAIL;",
  pearls: "  var PEARL=40, TN=WORMS*PEARL, TSTRIDE=5;",
  scale: "    gl.uniform2f(U.u_scale,0.72*aspX,0.72*aspY);",
  dotSize: "    gl.uniform1f(U.u_px,Math.max(1.0,size/1080*7.6*PSIZE));",
  threshold: "    gl.uniform1f(U.u_thr,0.20+0.05*Math.sin(th*2+0.8));",
  wormFalloff: "  '      boost+=u_worm[i].w*exp(-dot(d,d)*450.0);',",
  dotProfile: "  '  v_k=(u_pass>0.5)?3.0:(u_trail>0.5?0.0:2.1);',",
  points: `  var SKEL=[], CHAIN=[];
  (function(){
    /* one recursive limb: walk it in short steps, then fork off children */
    function grow(px,py,pz,dx,dy,dz,len,rad,depth,chain){
      var steps=Math.max(2,Math.round(len*16));
      var sl=len/steps;
      for(var s=0;s<steps;s++){
        var nx=px+dx*sl, ny=py+dy*sl, nz=pz+dz*sl;
        SKEL.push([px,py,pz,nx,ny,nz,rad*(1-0.45*s/steps)]);
        chain.push([nx,ny,nz]);
        px=nx; py=ny; pz=nz;
        /* a gentle curl keeps the limbs from reading as straight spokes */
        dx+=(R0()*2-1)*0.20; dy+=(R0()*2-1)*0.11+0.02; dz+=(R0()*2-1)*0.20;
        var dl=1/Math.hypot(dx,dy,dz); dx*=dl; dy*=dl; dz*=dl;
      }
      if(depth>=5||len<0.060){ CHAIN.push(chain.slice()); return; }
      var forks=depth<3?3:2;
      for(var f=0;f<forks;f++){
        /* a wide fork angle is what makes the crown read as a canopy instead
           of a torch flame; the small upward bias only keeps it from drooping */
        var fa=R0()*6.283, sp=0.78+R0()*0.62;
        var bx=dx+Math.cos(fa)*sp, by=dy+0.06, bz=dz+Math.sin(fa)*sp;
        var bl=1/Math.hypot(bx,by,bz);
        grow(px,py,pz,bx*bl,by*bl,bz*bl,len*0.80,rad*0.63,depth+1,chain.slice());
      }
    }
    grow(0,-0.90,0,0,1,0,0.42,0.070,0,[[0,-0.90,0]]);
  })();
  /* the grown tree is recentred and normalized, so the crown fills the frame
     whatever the fork angles happened to do */
  var lo3=[1e9,1e9,1e9], hi3=[-1e9,-1e9,-1e9];
  for(var q=0;q<SKEL.length;q++){
    for(var ei=0;ei<6;ei++){
      var ax3=ei%3, vv3=SKEL[q][ei];
      if(vv3<lo3[ax3]) lo3[ax3]=vv3;
      if(vv3>hi3[ax3]) hi3[ax3]=vv3;
    }
  }
  var mid3=[(lo3[0]+hi3[0])*0.5,(lo3[1]+hi3[1])*0.5,(lo3[2]+hi3[2])*0.5];
  var NRM=1.92/Math.max(1e-6,hi3[1]-lo3[1]);
  for(q=0;q<SKEL.length;q++){
    var sg3=SKEL[q];
    for(ei=0;ei<6;ei++) sg3[ei]=(sg3[ei]-mid3[ei%3])*NRM;
    sg3[6]*=NRM;
  }
  for(q=0;q<CHAIN.length;q++){
    /* every chain shares the trunk nodes with its siblings, so each slot takes
       a fresh normalized point instead of being rescaled in place */
    var ch3=CHAIN[q];
    for(ei=0;ei<ch3.length;ei++) ch3[ei]=[(ch3[ei][0]-mid3[0])*NRM,(ch3[ei][1]-mid3[1])*NRM,(ch3[ei][2]-mid3[2])*NRM];
  }
  /* one cumulative table weighted by length times radius, so the grain lands
     by bark area — weighting by length alone starves the trunk, because the
     hundred-odd twigs carry most of the skeleton's total length */
  var CUM=new Float64Array(SKEL.length), TOT=0;
  for(q=0;q<SKEL.length;q++){
    TOT+=Math.hypot(SKEL[q][3]-SKEL[q][0],SKEL[q][4]-SKEL[q][1],SKEL[q][5]-SKEL[q][2])*SKEL[q][6];
    CUM[q]=TOT;
  }
  for(var i=0;i<N;i++){
    var pick=R0()*TOT, lo=0, hi=SKEL.length-1;
    while(lo<hi){ var mid=(lo+hi)>>1; if(CUM[mid]<pick) lo=mid+1; else hi=mid; }
    var sg=SKEL[lo], tt=R0();
    var bx0=sg[0]+(sg[3]-sg[0])*tt, by0=sg[1]+(sg[4]-sg[1])*tt, bz0=sg[2]+(sg[5]-sg[2])*tt;
    /* scatter inside the limb radius so each branch reads as bark, not a wire */
    var rr=sg[6]*Math.pow(R0(),0.55), ra=R0()*6.283, rp=Math.acos(2*R0()-1);
    dirs[i*3]=bx0+rr*Math.sin(rp)*Math.cos(ra);
    dirs[i*3+1]=by0+rr*Math.cos(rp);
    dirs[i*3+2]=bz0+rr*Math.sin(rp)*Math.sin(ra);
    rnds[i*2]=R0(); rnds[i*2+1]=R0();
  }
`,
  paths: `  var W=[];
  for(i=0;i<WORMS;i++){
    /* every rope owns one limb, entering it above the shared trunk so eight
       pulses do not pile onto the same few nodes at once */
    W.push({ch:CHAIN[Math.min(CHAIN.length-1,Math.floor(R0()*CHAIN.length))],
            u0:0.20+R0()*0.34,m:1+Math.floor(R0()*2),ph:R0()*6.283,
            str:0.72+R0()*0.26,arc:1.55+R0()*0.90,fl:R0()*6.283});
  }
  /* a point on rope k's limb at angle ang, written into out[] — the parameter
     folds back on itself, so the pulse runs out to the tip and returns without
     a seam and the tail bunches into a flare while it turns around */
  function onPath(w,ang,out){
    var f=ang/6.283185307179586; f-=Math.floor(f);
    var u=w.u0+(1-w.u0)*(1-Math.abs(1-2*f));
    var x=u*(w.ch.length-1), k=Math.floor(x), t=x-k;
    if(k>w.ch.length-2){ k=w.ch.length-2; t=1; }
    if(k<0){ k=0; t=0; }
    var a=w.ch[k], b=w.ch[k+1];
    out[0]=a[0]+(b[0]-a[0])*t;
    out[1]=a[1]+(b[1]-a[1])*t;
    out[2]=a[2]+(b[2]-a[2])*t;
  }
`,
  shape: `'  vec3 dir=a_dir;',
  '  vec2 c=vec2(cos(u_th),sin(u_th));',
  /* every noise lookup rides a closed circular path, so the sway is exactly
     periodic; the wavelength control scales all of them together */
  '  float iw=1.0/u_wave;',
  '  float n1=snoise(dir*(1.90*iw)+vec3(c*0.72,0.0));',
  '  float n2=snoise(dir*(4.20*iw)+vec3(0.0,c*0.60));',
  '  float n3=snoise(dir*(8.40*iw)+vec3(c.y*0.48,0.0,c.x*0.48));',
  /* the canopy sways, the trunk holds still */
  '  float lift=smoothstep(-0.95,0.60,dir.y);',
  '  vec3 q0=dir+vec3(n1*1.10,n2*0.34,n3*0.90)*0.085*lift;',
  '  float shade=clamp(0.40+0.60*lift+0.22*n1,0.0,1.0);',
  /* recursive erosion: two scales of noise eat the limbs back from the tips
     while the trunk and the lower limbs stay whole, so the crown never floats */
  '  float e=0.64*snoise(dir*(1.80*iw)+vec3(c*1.20,0.4))+0.36*snoise(dir*(3.90*iw)+vec3(0.3,c*1.05));',
  '  float alive=smoothstep(u_thr-0.06,u_thr+0.08,e+0.5+0.50*(1.0-smoothstep(-0.90,0.15,dir.y)));',
  '  vec3 n=normalize(u_rot*(q0+vec3(0.0,0.22,0.0)));',
  '  vec3 p=u_rot*q0;',
  '  float persp=1.0/(1.0-0.18*p.z);',
  '  float face=1.0;',`,
  palette: [
    "  '  vec3 cDim=vec3(0.72,0.26,0.06);',",
    "  '  vec3 cMid=vec3(1.00,0.58,0.16);',",
    "  '  vec3 cHot=vec3(1.00,0.90,0.62);',",
  ],
  tint: "  '  vec3 col=mix(cDim,cMid,clamp(shade*0.78+a_rand.x*0.32,0.0,1.0));',",
  rotation: `    var ax=0.10*Math.sin(th)+0.03*Math.sin(th*2+1.1);
    var ay=th;
    var az=0.05*Math.cos(th+0.6);`,
  grain: "        d[i]=n; d[i+1]=n*0.70; d[i+2]=n*0.44; d[i+3]=255;",
  lightBackground: "#f4f3f1",
  darkBackground: "#0a0908",
};

const RECURSIVE_EROSION_MOUNTAINS: RecursiveErosionStyle = {
  title: "Recursive Erosion — Mountain Range Motion Study",
  screenReaderCopy: "A looping study of a generative mountain range: a height field of small dots over a transparent backdrop, its ridges drifting and eroding into scree while bright glowing veins run down the slopes, each dot fringed with red and blue chromatic aberration.",
  duration: "  var DUR=9.0;                  /* reference loop length */",
  lattice: "  var N=16640;                  /* lattice points */",
  ropes: "  var WORMS=6, TAIL=14, WN=WORMS*TAIL;",
  pearls: "  var PEARL=46, TN=WORMS*PEARL, TSTRIDE=5;",
  scale: "    gl.uniform2f(U.u_scale,0.72*aspX,0.72*aspY);",
  dotSize: "    gl.uniform1f(U.u_px,Math.max(1.0,size/1080*6.8*PSIZE));",
  threshold: "    gl.uniform1f(U.u_thr,0.17+0.05*Math.sin(th*2+0.8));",
  wormFalloff: "  '      boost+=u_worm[i].w*exp(-dot(d,d)*130.0);',",
  dotProfile: "  '  v_k=(u_pass>0.5)?3.0:(u_trail>0.5?0.0:2.1);',",
  points: `  var NZ=64, PER=Math.max(1,Math.floor(N/NZ));
  for(var i=0;i<N;i++){
    /* the buffer is filled far row first. With premultiplied over-blending and
       no depth test, later points paint over earlier ones, so a near ridge hides
       the range standing behind it and the relief reads solid instead of
       transparent — this ordering is what makes the silhouette. */
    var uz=(Math.floor(i/PER)+0.5+(R0()*2-1)*0.40)/NZ;
    /* negative z is the far side; rows tighten toward it so distant ridges
       keep their grain instead of thinning out as they shrink */
    var vz=Math.pow(uz,1.30);
    dirs[i*3]=(R0()*2-1)*1.90;
    dirs[i*3+1]=0;
    dirs[i*3+2]=vz*2.20-1.10;
    rnds[i*2]=R0(); rnds[i*2+1]=R0();
  }
`,
  paths: `  var W=[];
  for(i=0;i<WORMS;i++){
    /* every vein wanders across the base plane; the shader lifts it onto the
       ridge with the same height field the lattice is displaced by */
    W.push({x0:(R0()*2-1)*1.30,am:0.20+R0()*0.32,fr:2.1+R0()*3.4,
            m:1+Math.floor(R0()*2),ph:R0()*6.283,
            str:0.92+R0()*0.30,arc:1.50+R0()*1.00,fl:R0()*6.283});
  }
  /* a point on vein k at angle ang, written into out[] — the parameter folds
     back on itself, so the flow runs down the slope and climbs back seamlessly */
  function onPath(w,ang,out){
    var f=ang/6.283185307179586; f-=Math.floor(f);
    var u=1-Math.abs(1-2*f);
    out[0]=w.x0+Math.sin(u*w.fr+w.ph)*w.am;
    out[1]=0;
    out[2]=1.05-2.10*u;
  }
`,
  shape: `'  vec3 dir=a_dir;',
  '  vec2 c=vec2(cos(u_th),sin(u_th));',
  /* the height field is read on a flat slice whose sample point rides a closed
     circular path, so the range drifts and morphs exactly periodically; the
     wavelength control scales every lookup together */
  '  float iw=1.0/u_wave;',
  '  vec3 g=vec3(dir.x,dir.z,0.0);',
  '  float n1=snoise(g*(1.05*iw)+vec3(c*0.42,0.0));',
  '  float n2=snoise(g*(2.35*iw)+vec3(0.0,c*0.36));',
  '  float n3=snoise(g*(5.30*iw)+vec3(c.y*0.30,0.0,c.x*0.30));',
  /* a ridged fractal: folding the noise about zero turns smooth hills into
     crests, and squaring the fold sharpens those crests into a skyline */
  '  float r1=1.0-abs(n1), r2=1.0-abs(n2);',
  '  float h=0.86*r1*r1+0.40*r2*r1+0.15*n3-0.58;',
  /* the range settles toward the near edge, so the front reads as a valley floor */
  '  h*=0.42+0.58*smoothstep(-0.55,1.15,-dir.z);',
  '  float shade=clamp(0.28+1.45*h,0.0,1.0);',
  /* recursive erosion: two scales of noise strip the scree off the slopes */
  '  float e=0.62*snoise(g*(1.55*iw)+vec3(c*1.10,0.4))+0.38*snoise(g*(3.30*iw)+vec3(0.3,c*0.95));',
  '  float alive=smoothstep(u_thr-0.07,u_thr+0.09,e+0.5+0.40*smoothstep(0.0,0.34,h));',
  '  vec3 q0=vec3(dir.x,h,dir.z);',
  '  vec3 n=u_rot*vec3(0.0,1.0,0.0);',
  '  vec3 p=u_rot*q0;',
  '  float persp=1.0/(1.0-0.26*p.z);',
  /* only the far rows haze out: everything else keeps full coverage, because
     the near rows have to paint over the far ones for the relief to read solid */
  '  float face=1.0-0.45*smoothstep(0.30,1.12,-dir.z);',`,
  palette: [
    "  '  vec3 cDim=vec3(0.30,0.22,0.42);',",
    "  '  vec3 cMid=vec3(0.94,0.45,0.20);',",
    "  '  vec3 cHot=vec3(1.00,0.83,0.48);',",
  ],
  tint: "  '  vec3 col=mix(cDim,cMid,clamp(shade*shade*1.15+a_rand.x*0.12,0.0,1.0));',",
  rotation: `    var ax=0.32+0.018*Math.sin(th);
    var ay=0.16*Math.sin(th+2.2);
    var az=0.0;`,
  grain: "        d[i]=n*0.86; d[i+1]=n*0.62; d[i+2]=n*0.74; d[i+3]=255;",
  lightBackground: "#f2f1f5",
  darkBackground: "#0b0a10",
};

const RECURSIVE_EROSION_NEBULA: RecursiveErosionStyle = {
  title: "Recursive Erosion — Nebula Cloud Motion Study",
  screenReaderCopy: "A looping study of a generative nebula: a volumetric cloud of small violet and magenta dots over a transparent backdrop, shearing around its own core and eroding into voids while bright glowing filaments wind through it, each dot fringed with red and blue chromatic aberration.",
  duration: "  var DUR=8.0;                  /* reference loop length */",
  lattice: "  var N=9000;                   /* lattice points */",
  ropes: "  var WORMS=7, TAIL=12, WN=WORMS*TAIL;",
  pearls: "  var PEARL=64, TN=WORMS*PEARL, TSTRIDE=5;",
  scale: "    gl.uniform2f(U.u_scale,0.66*aspX,0.66*aspY);",
  dotSize: "    gl.uniform1f(U.u_px,Math.max(1.0,size/1080*9.5*PSIZE));",
  threshold: "    gl.uniform1f(U.u_thr,0.12+0.05*Math.sin(th*2+0.8));",
  wormFalloff: "  '      boost+=u_worm[i].w*exp(-dot(d,d)*150.0);',",
  dotProfile: "  '  v_k=(u_pass>0.5)?3.0:1.2;',",
  points: `  var LOBE=[];
  for(var q=0;q<6;q++) LOBE.push([(R0()*2-1)*0.52,(R0()*2-1)*0.30,(R0()*2-1)*0.52,0.22+R0()*0.30]);
  for(var i=0;i<N;i++){
    var L=LOBE[Math.min(LOBE.length-1,Math.floor(R0()*LOBE.length))];
    /* three summed uniforms approximate a gaussian, so each lobe keeps a dense
       core that thins out instead of ending on a hard edge */
    var g1=R0()+R0()+R0()-1.5, g2=R0()+R0()+R0()-1.5, g3=R0()+R0()+R0()-1.5;
    dirs[i*3]=L[0]+g1*L[3]*2.10;
    dirs[i*3+1]=L[1]+g2*L[3]*1.25;
    dirs[i*3+2]=L[2]+g3*L[3]*2.10;
    rnds[i*2]=R0(); rnds[i*2+1]=R0();
  }
`,
  paths: `  var W=[];
  for(i=0;i<WORMS;i++){
    /* every filament rides a tilted ring through the cloud, so the loop stays
       seamless and a steady handful of them is always inside the volume */
    var cz=(R0()*2-1)*0.85, ca0=R0()*6.283, cr=Math.sqrt(Math.max(0,1-cz*cz));
    var c=[Math.cos(ca0)*cr,Math.sin(ca0)*cr,cz];
    var t0=Math.abs(c[1])<0.85?[0,1,0]:[1,0,0];
    var d=t0[0]*c[0]+t0[1]*c[1]+t0[2]*c[2];
    var u=[t0[0]-c[0]*d,t0[1]-c[1]*d,t0[2]-c[2]*d];
    var lu=Math.hypot(u[0],u[1],u[2]); u=[u[0]/lu,u[1]/lu,u[2]/lu];
    var v=[c[1]*u[2]-c[2]*u[1],c[2]*u[0]-c[0]*u[2],c[0]*u[1]-c[1]*u[0]];
    W.push({c:c,u:u,v:v,rad:0.34+R0()*0.80,off:(R0()*2-1)*0.46,
            m:1+Math.floor(R0()*2),ph:R0()*6.283,
            str:0.88+R0()*0.32,arc:1.35+R0()*0.85,fl:R0()*6.283});
  }
  /* a point on filament k's ring at angle ang, written into out[] */
  function onPath(w,ang,out){
    var ca=Math.cos(ang), sa=Math.sin(ang);
    out[0]=w.c[0]*w.off+(w.u[0]*ca+w.v[0]*sa)*w.rad;
    out[1]=w.c[1]*w.off+(w.u[1]*ca+w.v[1]*sa)*w.rad;
    out[2]=w.c[2]*w.off+(w.u[2]*ca+w.v[2]*sa)*w.rad;
  }
`,
  shape: `'  vec3 dir=a_dir;',
  '  vec2 c=vec2(cos(u_th),sin(u_th));',
  /* every noise lookup rides a closed circular path, so the shear is exactly
     periodic; the wavelength control scales all of them together */
  '  float iw=1.0/u_wave;',
  '  float n1=snoise(dir*(1.20*iw)+vec3(c*0.82,0.0));',
  '  float n2=snoise(dir*(2.45*iw)+vec3(0.0,c*0.68));',
  '  float n3=snoise(dir*(5.10*iw)+vec3(c.y*0.52,0.0,c.x*0.52));',
  '  float rad=length(dir);',
  /* the cloud shears around its own core instead of pulsing in and out; the
     ropes take a fraction of that shear, or the high-frequency term would
     shatter each filament into unrelated dots */
  '  vec3 q0=dir+vec3(n2-n3,n3-n1,n1-n2)*(u_trail>0.5?0.14:0.26)*(0.30+0.70*rad);',
  '  float shade=clamp(0.5+0.62*n1+0.30*n3-0.42*rad,0.0,1.0);',
  /* recursive erosion, folded about zero: where the summed noise crosses zero
     the cloud survives as a thin sheet, so the voids are separated by filaments
     rather than by an even fog */
  '  float e=1.0-abs(0.62*snoise(dir*(1.35*iw)+vec3(c*1.15,0.4))+0.38*snoise(dir*(2.90*iw)+vec3(0.3,c*0.95)));',
  '  float alive=smoothstep(u_thr+0.24,u_thr+0.78,e+0.34*(1.0-smoothstep(0.10,1.15,rad)));',
  '  vec3 n=normalize(u_rot*q0+vec3(0.0,0.0,0.0001));',
  '  vec3 p=u_rot*q0;',
  '  float persp=1.0/(1.0-0.22*p.z);',
  /* cloud dots stay translucent so the volume builds up as haze instead of
     reading as a bag of discs, and the core carries the extra density — the
     filament ropes opt out, or they would be hazed away with everything else */
  '  float face=(u_trail>0.5)?1.0:(0.20+0.56*smoothstep(-1.15,0.85,p.z))*(1.0+0.95*(1.0-smoothstep(0.0,0.60,rad)));',`,
  palette: [
    "  '  vec3 cDim=vec3(0.30,0.18,0.62);',",
    "  '  vec3 cMid=vec3(0.86,0.24,0.62);',",
    "  '  vec3 cHot=vec3(1.00,0.78,0.94);',",
  ],
  tint: "  '  vec3 col=mix(cDim,cMid,clamp(shade*0.85+a_rand.x*0.30,0.0,1.0));',",
  rotation: `    var ax=0.16*Math.sin(th)+0.05*Math.sin(th*2+1.1);
    var ay=0.42*Math.sin(th+2.2)+0.10*Math.cos(th*2);
    var az=0.08*Math.cos(th+0.6);`,
  grain: "        d[i]=n*0.78; d[i+1]=n*0.52; d[i+2]=n; d[i+3]=255;",
  lightBackground: "#f4f2f8",
  darkBackground: "#08060f",
};

const RECURSIVE_EROSION_STYLES = {
  sphere: RECURSIVE_EROSION_SPHERE,
  branches: RECURSIVE_EROSION_BRANCHES,
  mountains: RECURSIVE_EROSION_MOUNTAINS,
  nebula: RECURSIVE_EROSION_NEBULA,
} as const;

export type RecursiveErosionVariant = keyof typeof RECURSIVE_EROSION_STYLES;

export const RECURSIVE_EROSION_DEFAULTS = {
  ...NEUFORM_ISOLATED_DEFAULTS,
  variant: "sphere",
  speed: 1,
  pointSize: 1,
  wavelength: 1,
} as const;

/* the live-control and pointer channel every style carries */
const RECURSIVE_EROSION_HOST_RUNTIME = `  /* ------------------------------------------------------------------ *
     host controls — this document is served through a srcDoc iframe, so it
     cannot take a live React prop without being rebuilt, and rebuilding it
     would restart the loop on every slider tick. Speed, point size, and
     wavelength arrive by postMessage and land on the next frame; the pointer
     is read here and handed to the shader in clip space, the same space
     gl_Position is written in.
   * ------------------------------------------------------------------ */
  var SPEED=1, PSIZE=1, WAVE=1;
  var PX=0, PY=0, PA=0, tPX=0, tPY=0, tPA=0;
  window.addEventListener('message',function(ev){
    var d=ev&&ev.data&&ev.data.threeuiRuntime;
    if(!d) return;
    if(typeof d.speed==='number') SPEED=Math.max(0,Math.min(3,d.speed));
    if(typeof d.pointSize==='number') PSIZE=Math.max(0.35,Math.min(2.5,d.pointSize));
    if(typeof d.wavelength==='number') WAVE=Math.max(0.4,Math.min(2.5,d.wavelength));
    /* a paused document still has to repaint, or the sliders look dead */
    if(!playing) render(at);
  });
  var PREF=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!PREF){
    /* the isolating host marks the background stage pointer-events:none, so the
       cursor never hit-tests onto it — the listener goes on the document, which
       still sees every move over the frame, and the stage is only measured */
    window.addEventListener('pointermove',function(ev){
      var r=stage.getBoundingClientRect();
      if(!r.width||!r.height) return;
      tPX=((ev.clientX-r.left)/r.width)*2-1;
      tPY=1-((ev.clientY-r.top)/r.height)*2;
      tPA=1;
    });
    document.documentElement.addEventListener('pointerleave',function(){tPA=0});
    window.addEventListener('pointercancel',function(){tPA=0});
    window.addEventListener('blur',function(){tPA=0});
  }
`;

function transformRecursiveErosionSource(source: string, style: RecursiveErosionStyle) {
  let served = source
    .replace("<title>Recursive Erosion — Particle Sphere Motion Study</title>", `<title>${style.title}</title>`)
    .replace(/<p class="sr">[\s\S]*?<\/p>/, `<p class="sr">${style.screenReaderCopy}</p>`)
    .replace("  var DUR=3.99;                 /* reference loop length */", style.duration)
    .replace("  var N=2500;                   /* lattice points */", style.lattice)
    .replace("  var WORMS=7, TAIL=14, WN=WORMS*TAIL;", style.ropes)
    .replace("  var PEARL=34, TN=WORMS*PEARL, TSTRIDE=5;", style.pearls)
    .replace(
      "  'uniform float u_th, u_px, u_pass, u_thr, u_trail;',",
      "  'uniform float u_th, u_px, u_pass, u_thr, u_trail, u_wave;',\n  'uniform vec3 u_ptr;',",
    )
    .replace(RECURSIVE_EROSION_SHAPE_BLOCK, style.shape)
    .replace("  '      boost+=u_worm[i].w*exp(-dot(d,d)*260.0);',", style.wormFalloff)
    .replace("  '  vec3 cDim=vec3(0.94,0.33,0.05);',", style.palette[0])
    .replace("  '  vec3 cMid=vec3(1.00,0.56,0.16);',", style.palette[1])
    .replace("  '  vec3 cHot=vec3(1.00,0.71,0.31);',", style.palette[2])
    .replace("  '  vec3 col=mix(cDim,cMid,a_rand.x*a_rand.x);',", style.tint)
    .replace("  '  v_k=(u_pass>0.5)?3.0:(u_trail>0.5?0.0:2.1);',", style.dotProfile)
    .replace(RECURSIVE_EROSION_PATH_BLOCK, style.paths)
    .replace(RECURSIVE_EROSION_ROTATION_BLOCK, style.rotation)
    .replace("        d[i]=n; d[i+1]=n*0.74; d[i+2]=n*0.52; d[i+3]=255;", style.grain)
    /* the grain rides the same clock, so speed 0 is a still frame and not a
       frozen field under a crawling overlay */
    .replace("    grain(frameNo++);", "    grain(SPEED>0?frameNo++:frameNo);")
    .replace(
      "  ['u_rot','u_th','u_scale','u_px','u_pass','u_thr','u_off','u_worm','u_trail'].forEach(function(k){",
      "  ['u_rot','u_th','u_scale','u_px','u_pass','u_thr','u_off','u_worm','u_trail','u_ptr','u_wave'].forEach(function(k){",
    )
    .replace("  var frameNo=0;", `${RECURSIVE_EROSION_HOST_RUNTIME}  var frameNo=0;`)
    .replace(
      "    var th=2*Math.PI*(t/DUR);\n    worms(th); rope(th);",
      "    var th=2*Math.PI*(t/DUR);\n    /* ease the pointer, so a fast flick pulls the field instead of snapping it */\n    PX+=(tPX-PX)*0.16; PY+=(tPY-PY)*0.16; PA+=(tPA-PA)*0.10;\n    worms(th); rope(th);",
    )
    .replace(
      "    gl.uniform4fv(U.u_worm,wormPos);",
      "    gl.uniform4fv(U.u_worm,wormPos);\n    gl.uniform3f(U.u_ptr,PX,PY,PA);\n    gl.uniform1f(U.u_wave,WAVE);",
    )
    .replace(
      "  function play(){if(playing&&raf)return;playing=true;start=performance.now()-at*1000;if(!raf)raf=requestAnimationFrame(tick)}",
      "  function play(){if(playing&&raf)return;playing=true;start=null;if(!raf)raf=requestAnimationFrame(tick)}",
    )
    .replace(
      "    if(start===null)start=now;\n    at=((now-start)/1000)%DUR;",
      "    if(start===null)start=now;\n    /* the clock accumulates, so the speed control changes the rate instead of\n       rescaling elapsed time, which would jump the phase on every change */\n    var dt=Math.min(0.1,(now-start)/1000); start=now;\n    at=(at+dt*SPEED)%DUR;",
    )
    .replace("    gl.uniform2f(U.u_scale,0.672*aspX,0.672*aspY);", style.scale)
    .replace("    gl.uniform1f(U.u_px,Math.max(1.0,size/1080*8.0));", style.dotSize)
    .replace("    gl.uniform1f(U.u_thr,0.19+0.04*Math.sin(th*2+0.8));", style.threshold);

  if (style.points) served = served.replace(RECURSIVE_EROSION_POINT_BLOCK, style.points);
  if (style.pointerBoost) served = served.replace("  '    boost=min(boost,1.5);',", style.pointerBoost);
  if (style.projection) served = served.replace("  '  gl_Position=vec4(p.xy*persp*u_scale+u_off,0.0,1.0);',", style.projection);
  if (style.flicker) {
    served = served
      .replace(RECURSIVE_EROSION_HALO_FLICKER, style.flicker)
      .replace(RECURSIVE_EROSION_ROPE_FLICKER, style.flicker);
  }
  return served;
}

function transformEpiludeWordmarkSource(source: string, mode: EffectMode) {
  const palette = mode === "light"
    ? "[[8, 10, 15], [40, 48, 62], [85, 96, 116]]"
    : "[[255, 255, 255], [226, 232, 240], [191, 205, 225]]";

  return source
    .replace("<title>Epilude — Footer</title>", "<title>Shaders Particle Wordmark</title>")
    .replace("aspect-ratio: 8.541554959785524;", "aspect-ratio: 5.333333333333333;")
    .replace(/var WORDMARK =[\s\S]*?"<\/svg>";/, `var WORDMARK = ${JSON.stringify(SHADERS_WORDMARK_SVG)};`)
    .replace("var PALETTE = [[255, 255, 255], [226, 232, 240], [191, 205, 225]];", `var PALETTE = ${palette};`)
    .replace("a: 0.04 + 0.95 * band * Math.pow(flake, 1.8)", "a: 0.14 + 0.86 * band * Math.pow(flake, 1.8)");
}

function transformAudioWordmarkSource(source: string, mode: EffectMode) {
  const background = mode === "light" ? "#f4f7fb" : "#000";
  const ink = mode === "light" ? "#172033" : "#E8EEE9";
  const secondaryInk = mode === "light" ? "#536076" : "#c9d4cc";
  const accent = mode === "light" ? "#315efb" : "#7080ff";

  return source
    .replace("<title>Supreme Radio — Graphic Identity</title>", "<title>ThreeUI — Audio Wordmark</title>")
    .replaceAll("supreme radio", "ThreeUI")
    .replaceAll("#EA3927", accent)
    .replaceAll("#E8EEE9", ink)
    .replaceAll("#E3EDE5", ink)
    .replaceAll("#c9d4cc", secondaryInk)
    .replaceAll("#000", background)
    .replace("var DUR = 20;", "var DUR = 4.7;");
}

const EFFECTS = {
  expanse: {
    title: "Expanse Field shader background",
    source: expanseSource,
    background: "#07080b",
    targets: [{ selector: "#glcanvas", role: "background" }],
  },
  starfield: {
    title: "Imaginie star portal",
    source: starfieldSource,
    background: "#0d0a12",
    theme: {
      nativeMode: "dark",
      lightBackground: "#f4f7fb",
      darkBackground: "#0d0a12",
      invertBackground: true,
    },
    targets: [
      { selector: "#ambient-starfield", role: "background" },
      { selector: "#portal-stars", role: "background" },
      { selector: ".holo-btn", role: "button" },
    ],
  },
  particleOrb: {
    title: "Synthesis autonomous orb",
    source: particleOrbSource,
    background: "#050505",
    targets: [{ selector: "#orbCanvas", role: "background" }],
  },
  performanceGaugesTachometer: {
    title: "Tachometer diagnostic gauge",
    source: performanceGaugesSource,
    background: "#000000",
    targets: [{ selector: "#gauge-tachometer", role: "visual", fit: "contain-square" }],
  },
  performanceGaugesSpeedometer: {
    title: "Speedometer diagnostic gauge",
    source: performanceGaugesSource,
    background: "#000000",
    targets: [{ selector: "#gauge-speedometer", role: "visual", fit: "contain-square" }],
  },
  performanceGaugesBoost: {
    title: "Turbo boost diagnostic gauge",
    source: performanceGaugesSource,
    background: "#000000",
    targets: [{ selector: "#gauge-boost", role: "visual", fit: "contain-square" }],
  },
  performanceGaugesPower: {
    title: "EV power diagnostic gauge",
    source: performanceGaugesSource,
    background: "#000000",
    targets: [{ selector: "#gauge-power", role: "visual", fit: "contain-square" }],
  },
  logicCore: {
    title: "Logic Core isometric field",
    source: logicCoreSource,
    background: "#050505",
    targets: [{ selector: "#three-canvas-container", role: "background" }],
  },
  ignition: {
    title: "Ignition Button shader button",
    source: ignitionSource,
    background: "#f0ede7",
    theme: {
      nativeMode: "light",
      lightBackground: "#f0ede7",
      darkBackground: "#121316",
      invertBackground: true,
    },
    targets: [
      { selector: "#bg-gl", role: "background" },
      { selector: "#btn", role: "button" },
    ],
  },
  induction: {
    title: "Induction Button kinetic button",
    source: inductionSource,
    background: "#050505",
    theme: {
      nativeMode: "dark",
      lightBackground: "#f4f7fb",
      darkBackground: "#050505",
      invertBackground: true,
    },
    targets: [
      { selector: "#bg-canvas", role: "background" },
      { selector: "#btn", role: "button" },
    ],
  },
  aetherisLabs: {
    title: "Aetheris Labs plasma button",
    source: aetherisLabsSource,
    background: "#020614",
    theme: {
      nativeMode: "dark",
      lightBackground: "#f4f7fb",
      darkBackground: "#020614",
      invertBackground: true,
    },
    targets: [
      { selector: "#bg-gl", role: "background" },
      { selector: "#btn", role: "button" },
    ],
  },
  tactile: {
    title: "Nexus tactile fluidics button",
    source: tactileSource,
    background: "#03090d",
    theme: {
      nativeMode: "dark",
      lightBackground: "#f4f7fb",
      darkBackground: "#03090d",
      invertBackground: true,
    },
    targets: [
      { selector: "#bg-canvas", role: "background" },
      { selector: "#btn", role: "button" },
    ],
  },
  thinking: {
    title: "Thinking Button canvas animation",
    source: thinkingSource,
    background: "#111318",
    theme: {
      lightBackground: "#f4f7fb",
      darkBackground: "#111318",
    },
    transformSource: transformThinkingButtonSource,
    targets: [{ selector: "#stage", role: "button" }],
  },
  slidingTextCta: {
    title: "Sliding Text CTA button",
    source: slidingTextCtaSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    targets: [{ selector: ".component-wrapper button", role: "button", preserveTransform: true }],
  },
  floatingDotsCta: {
    title: "Floating Dots CTA button",
    source: floatingDotsCtaSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    targets: [{ selector: ".component-wrapper button", role: "button", preserveTransform: true }],
  },
  launchButton: {
    title: "Gradient Launch button",
    source: launchButtonSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    targets: [{ selector: ".component-wrapper button", role: "button", preserveTransform: true }],
  },
  dotBorderButton: {
    title: "Dot Border button",
    source: dotBorderButtonSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    transformSource: transformDotBorderButtonSource,
    targets: [{ selector: ".component-wrapper .btn-wrapper", role: "button", preserveTransform: true }],
  },
  gradientCta: {
    title: "Gradient CTA button",
    source: gradientCtaSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    targets: [{ selector: ".component-wrapper button", role: "button", preserveTransform: true }],
  },
  spinningBorderButton: {
    title: "Spinning Border button",
    source: spinningBorderButtonSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    targets: [{ selector: ".component-wrapper button", role: "button", preserveTransform: true }],
  },
  glassmorphismCta: {
    title: "Glassmorphism CTA button",
    source: glassmorphismCtaSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    targets: [{ selector: ".component-wrapper a", role: "button", preserveTransform: true }],
  },
  generateButton: {
    title: "Generate button",
    source: generateButtonSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    targets: [{ selector: ".component-wrapper .btn-wrapper", role: "button", preserveTransform: true }],
  },
  gradientPillButton: {
    title: "Gradient Pill button",
    source: gradientPillButtonSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    transformSource: transformGradientPillButtonSource,
    targets: [{ selector: ".component-wrapper button", role: "button", preserveTransform: true }],
  },
  gradientBeamCta: {
    title: "Gradient Beam CTA button",
    source: gradientBeamCtaSource,
    background: "#111318",
    theme: { lightBackground: "#f4f7fb", darkBackground: "#111318" },
    targets: [{ selector: ".component-wrapper button", role: "button", preserveTransform: true }],
  },
  recursiveErosion: {
    title: "Recursive Erosion particle sphere background",
    source: recursiveErosionSource,
    background: "#0a0908",
    theme: {
      lightBackground: "#f4f3f1",
      darkBackground: "#0a0908",
    },
    targets: [{ selector: "#stage", role: "background" }],
    hiddenTargets: ["#badge", ".sr"],
  },
  threeUIIntro: {
    title: "ThreeUI chromatic wordmark intro",
    source: creatorStudioIntroSource,
    background: "#000000",
    theme: {
      nativeMode: "dark",
      lightBackground: "#f4f7fb",
      darkBackground: "#000000",
      invertBackground: true,
    },
    targets: [{ selector: "#stage", role: "background" }],
    hiddenTargets: [".sr"],
    introWordmark: {
      sceneSelector: "#comp .scene:first-child",
      text: "ThreeUI",
      fontSize: 130,
      endTime: 1.7,
      holdTime: 1.1,
      logoSvg: THREEUI_MARK_SVG,
    },
  },
  particleWordmark: {
    title: "Shaders particle wordmark",
    source: epiludeFooterSource,
    background: "#0c0c0d",
    theme: {
      lightBackground: "#f4f7fb",
      darkBackground: "#0c0c0d",
    },
    transformSource: transformEpiludeWordmarkSource,
    targets: [{ selector: "#storm", role: "visual", fit: "wide-wordmark" }],
  },
  audioWordmark: {
    title: "ThreeUI audio wordmark",
    source: audioWordmarkSource,
    background: "#000000",
    theme: {
      lightBackground: "#f4f7fb",
      darkBackground: "#000000",
    },
    transformSource: transformAudioWordmarkSource,
    targets: [{ selector: "#stage", role: "visual", fit: "portrait-stage", preserveTransform: true }],
  },
  galleryHeading: {
    title: "Gallery Heading canvas animation",
    source: galleryHeadingSource,
    background: "#000000",
    theme: {
      lightBackground: "#f4f7fb",
      darkBackground: "#000000",
    },
    transformSource: (source, mode) => transformGalleryHeadingSource(source, mode, GALLERY_HEADING_VARIANTS[GALLERY_HEADING_DEFAULTS.variant]),
    targets: [{ selector: "#stage", role: "background" }],
  },
  dimensional: {
    title: "Vanguard dimensional architecture",
    source: dimensionalSource,
    background: "#050608",
    targets: [{ selector: "#webgl-canvas", role: "background" }],
  },
  cloud: {
    title: "Strata cloud migration field",
    source: cloudSource,
    background: "#071010",
    targets: [{ selector: "#c", role: "background" }],
  },
  vertex9: {
    title: "Vertex 9 global data field",
    source: vertex9Source,
    background: "#050505",
    targets: [{ selector: "#webgl-canvas", role: "background" }],
  },
  topology: {
    title: "Nexus topology field",
    source: topologySource,
    background: "#070707",
    targets: [{ selector: "#animationCanvas", role: "background" }],
  },
  voidField: {
    title: "Void Field shader background",
    source: voidFieldSource,
    background: "#030305",
    targets: [{ selector: "#webgl-canvas", role: "background" }],
  },
} as const satisfies Record<string, EffectDefinition>;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function effectBackground(definition: EffectDefinition, mode: EffectMode) {
  return definition.theme?.[`${mode}Background`] ?? definition.background;
}

function buildFocusedDocument(definition: EffectDefinition, mode: EffectMode) {
  const background = effectBackground(definition, mode);
  const invertBackground = definition.theme?.invertBackground === true && definition.theme.nativeMode !== mode;
  const source = definition.transformSource?.(definition.source, mode) ?? definition.source;
  const targetJson = JSON.stringify(definition.targets).replace(/</g, "\\u003c");
  const hiddenTargetJson = JSON.stringify(definition.hiddenTargets ?? []).replace(/</g, "\\u003c");
  const introWordmarkJson = JSON.stringify(definition.introWordmark ?? null).replace(/</g, "\\u003c");
  const modeJson = JSON.stringify(mode);
  const backgroundFilter = invertBackground ? "filter: invert(1) hue-rotate(180deg) saturate(.92) brightness(1.02) !important;" : "";
  const introWordmarkStyle = definition.introWordmark
    ? `${definition.introWordmark.sceneSelector} .tx { font-size: ${definition.introWordmark.fontSize}px !important; }`
    : "";
  const focusStyle = `<style data-threeui-focus>
html, body { width: 100% !important; height: 100% !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: ${background} !important; color-scheme: ${mode} !important; }
body { position: relative !important; display: flex !important; align-items: center !important; justify-content: center !important; }
body > * { visibility: hidden !important; }
body[data-threeui-ready] > [data-threeui-role] { visibility: visible !important; }
[data-threeui-residual] { display: none !important; }
[data-threeui-hidden] { display: none !important; }
[data-threeui-role="background"] { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; z-index: 0 !important; opacity: 1 !important; pointer-events: none !important; ${backgroundFilter} }
[data-threeui-role="background"][data-threeui-fit="contain-square"] { position: absolute !important; top: 50% !important; right: auto !important; bottom: auto !important; left: 50% !important; width: min(100vw, 100vh) !important; height: min(100vw, 100vh) !important; aspect-ratio: 1 / 1 !important; transform: translate(-50%, -50%) !important; }
[data-threeui-role="button"] { position: relative !important; z-index: 2 !important; opacity: 1 !important; flex: none !important; }
[data-threeui-role="button"]:not([data-threeui-preserve-transform]) { transform: none !important; }
[data-threeui-role="visual"] { position: relative !important; z-index: 1 !important; width: min(100%, 1040px) !important; max-width: 1040px !important; max-height: 100% !important; margin: auto !important; padding: 24px !important; overflow: auto !important; opacity: 1 !important; filter: none !important; }
[data-threeui-role="visual"]:not([data-threeui-preserve-transform]) { transform: none !important; }
[data-threeui-role="visual"][data-threeui-fit="contain-square"] { flex: none !important; width: min(calc(100vw - 32px), calc(100vh - 32px)) !important; max-width: none !important; height: min(calc(100vw - 32px), calc(100vh - 32px)) !important; max-height: none !important; aspect-ratio: 1 / 1 !important; padding: 0 !important; overflow: hidden !important; }
[data-threeui-role="visual"][data-threeui-fit="wide-wordmark"] { width: min(calc(100vw - 48px), 1180px) !important; max-width: calc(100vw - 48px) !important; height: auto !important; max-height: none !important; aspect-ratio: 16 / 3 !important; padding: 0 !important; overflow: hidden !important; }
[data-threeui-role="visual"][data-threeui-fit="portrait-stage"] { position: absolute !important; top: 50% !important; right: auto !important; bottom: auto !important; left: 50% !important; width: 1080px !important; max-width: none !important; height: 1350px !important; max-height: none !important; padding: 0 !important; overflow: hidden !important; transform-origin: center !important; }
${introWordmarkStyle}
</style>`;
  const focusScript = `<script data-threeui-focus>
(function () {
  document.documentElement.dataset.sfMode = ${modeJson};
  var isolated = false;
  function isolate() {
    if (isolated) return;
    var specs = ${targetJson};
    var hiddenSelectors = ${hiddenTargetJson};
    var introWordmark = ${introWordmarkJson};
    var roots = [];
    hiddenSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (element) {
        element.setAttribute('data-threeui-hidden', '');
        element.setAttribute('aria-hidden', 'true');
        if ('inert' in element) element.inert = true;
      });
    });
    specs.forEach(function (spec) {
      var element = document.querySelector(spec.selector);
      if (!element) return;
      element.setAttribute('data-threeui-role', spec.role);
      if (spec.fit) element.setAttribute('data-threeui-fit', spec.fit);
      if (spec.preserveTransform) element.setAttribute('data-threeui-preserve-transform', '');
      if (!roots.some(function (root) { return root.contains(element); })) roots.push(element);
    });
    if (introWordmark) {
      var introScene = document.querySelector(introWordmark.sceneSelector);
      var introText = introScene && introScene.querySelector('.tx');
      var introMark = introText && introText.querySelector('.mark');
      if (introText && introMark) {
        introMark.innerHTML = introWordmark.logoSvg;
        var introCharacters = Array.from(introText.children).filter(function (element) { return element !== introMark; });
        introCharacters.forEach(function (element, index) {
          element.textContent = introWordmark.text[index] === ' ' ? '\u00a0' : (introWordmark.text[index] || '');
          element.style.display = index < introWordmark.text.length ? 'inline-block' : 'none';
        });
      }
      var introReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var introStartedAt = performance.now();
      function renderIntroWordmark(now) {
        if (typeof window.__seek !== 'function') return;
        if (introReducedMotion) {
          window.__seek(introWordmark.endTime);
          return;
        }
        var introCycle = introWordmark.endTime + introWordmark.holdTime;
        var introTime = ((now - introStartedAt) / 1000) % introCycle;
        window.__seek(Math.min(introTime, introWordmark.endTime));
        requestAnimationFrame(renderIntroWordmark);
      }
      requestAnimationFrame(renderIntroWordmark);
    }
    if (!roots.length) return;
    isolated = true;
    roots.forEach(function (root) {
      var placeholderLink = root.matches('a[href="#"]') ? root : root.querySelector('a[href="#"]');
      if (placeholderLink) placeholderLink.addEventListener('click', function (event) { event.preventDefault(); });
      document.body.appendChild(root);
    });
    Array.from(document.body.children).forEach(function (element) {
      if (roots.indexOf(element) !== -1) return;
      element.setAttribute('data-threeui-residual', '');
      element.setAttribute('aria-hidden', 'true');
      if ('inert' in element) element.inert = true;
    });
    document.body.setAttribute('data-threeui-ready', '');
    requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); });
  }
  function scheduleIsolation() { setTimeout(isolate, 100); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleIsolation, { once: true });
  else scheduleIsolation();
  window.addEventListener('load', isolate, { once: true });
})();
</script>`;
  return source
    .replace(/<\/head>/i, `${focusStyle}</head>`)
    .replace(/<\/body>/i, `${focusScript}</body>`);
}

function NeuformIsolatedEffect({
  definition,
  mode = NEUFORM_ISOLATED_DEFAULTS.mode,
  hue = NEUFORM_ISOLATED_DEFAULTS.hue,
  saturation = NEUFORM_ISOLATED_DEFAULTS.saturation,
  brightness = NEUFORM_ISOLATED_DEFAULTS.brightness,
  runtime,
  trackPointerHover,
  className,
  style,
}: NeuformIsolatedEffectProps & {
  definition: EffectDefinition;
  runtime?: Readonly<Record<string, number | string>>;
  trackPointerHover?: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const safeMode: EffectMode = mode === "light" ? "light" : "dark";
  const background = effectBackground(definition, safeMode);
  const source = useMemo(() => buildFocusedDocument(definition, safeMode), [definition, safeMode]);
  const safeHue = clamp(hue, -180, 180);
  const safeSaturation = clamp(saturation, 0, 2);
  const safeBrightness = clamp(brightness, 0.35, 1.65);
  const filter = safeHue === 0 && safeSaturation === 1 && safeBrightness === 1
    ? undefined
    : `hue-rotate(${safeHue}deg) saturate(${safeSaturation}) brightness(${safeBrightness})`;

  /* the leave edge is a handshake. The frame announces that the pointer arrived,
     because the host document sees no moves at all while the pointer is over the
     frame; the host then reports the first move that lands outside the frame,
     because a sandboxed cross-process frame is not guaranteed a pointerleave. */
  useEffect(() => {
    const frame = frameRef.current;
    if (!trackPointerHover || !frame) return undefined;
    let inside = false;

    const leave = () => {
      if (!inside) return;
      inside = false;
      frame.contentWindow?.postMessage({ threeuiRuntime: { hover: 0 } }, "*");
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source === frame.contentWindow && event.data?.threeuiPointerOver) inside = true;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!inside) return;
      const bounds = frame.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) leave();
    };

    window.addEventListener("message", onMessage);
    window.addEventListener("pointermove", onPointerMove, true);
    frame.addEventListener("pointerleave", leave);
    document.addEventListener("mouseleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pointermove", onPointerMove, true);
      frame.removeEventListener("pointerleave", leave);
      document.removeEventListener("mouseleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, [trackPointerHover]);

  /* a srcDoc document cannot take a live prop, so continuous controls are posted
     into it instead of rebuilt into it — rebuilding restarts the animation */
  const runtimeMessage = runtime ? JSON.stringify(runtime) : null;
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !runtimeMessage) return;
    const post = () => frame.contentWindow?.postMessage({ threeuiRuntime: JSON.parse(runtimeMessage) }, "*");
    post();
    frame.addEventListener("load", post);
    return () => frame.removeEventListener("load", post);
  }, [runtimeMessage, source]);

  return (
    <iframe
      ref={frameRef}
      className={className}
      data-mode={safeMode}
      title={definition.title}
      srcDoc={source}
      sandbox="allow-scripts"
      loading="eager"
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
        background,
        filter,
        ...style,
      }}
    />
  );
}

function createEffectComponent(definition: EffectDefinition) {
  return function EffectComponent(props: NeuformIsolatedEffectProps) {
    return <NeuformIsolatedEffect {...props} definition={definition} />;
  };
}

export const ExpanseField = createEffectComponent(EFFECTS.expanse);
export const StarPortal = createEffectComponent(EFFECTS.starfield);
export const ParticleOrbField = createEffectComponent(EFFECTS.particleOrb);
const PERFORMANCE_GAUGE_VARIANTS = {
  tachometer: EFFECTS.performanceGaugesTachometer,
  speedometer: EFFECTS.performanceGaugesSpeedometer,
  boost: EFFECTS.performanceGaugesBoost,
  power: EFFECTS.performanceGaugesPower,
} as const;

export type PerformanceGaugesVariant = keyof typeof PERFORMANCE_GAUGE_VARIANTS;

export const PERFORMANCE_GAUGES_DEFAULTS = {
  ...NEUFORM_ISOLATED_DEFAULTS,
  variant: "tachometer",
} as const;

export function PerformanceGauges({ variant = PERFORMANCE_GAUGES_DEFAULTS.variant, ...props }: NeuformIsolatedEffectProps & { variant?: PerformanceGaugesVariant }) {
  const definition = PERFORMANCE_GAUGE_VARIANTS[variant] ?? PERFORMANCE_GAUGE_VARIANTS.tachometer;
  return <NeuformIsolatedEffect {...props} definition={definition} />;
}
export const LogicCoreField = createEffectComponent(EFFECTS.logicCore);
export const IgnitionButton = createEffectComponent(EFFECTS.ignition);
export const InductionButton = createEffectComponent(EFFECTS.induction);
export const PlasmaButton = createEffectComponent(EFFECTS.aetherisLabs);
export const TactileButton = createEffectComponent(EFFECTS.tactile);
export const ThinkingButton = createEffectComponent(EFFECTS.thinking);
/** @deprecated Use ThinkingButton. */
export const UploadingButton = ThinkingButton;
export const SlidingTextCta = createEffectComponent(EFFECTS.slidingTextCta);
export const FloatingDotsCta = createEffectComponent(EFFECTS.floatingDotsCta);
export const LaunchButton = createEffectComponent(EFFECTS.launchButton);
export const DotBorderButton = createEffectComponent(EFFECTS.dotBorderButton);
export const GradientCta = createEffectComponent(EFFECTS.gradientCta);
export const SpinningBorderButton = createEffectComponent(EFFECTS.spinningBorderButton);
export const GlassmorphismCta = createEffectComponent(EFFECTS.glassmorphismCta);
export const GenerateButton = createEffectComponent(EFFECTS.generateButton);
export const GradientPillButton = createEffectComponent(EFFECTS.gradientPillButton);
export const GradientBeamCta = createEffectComponent(EFFECTS.gradientBeamCta);
export function RecursiveErosionBackground({
  variant = RECURSIVE_EROSION_DEFAULTS.variant,
  speed = RECURSIVE_EROSION_DEFAULTS.speed,
  pointSize = RECURSIVE_EROSION_DEFAULTS.pointSize,
  wavelength = RECURSIVE_EROSION_DEFAULTS.wavelength,
  ...props
}: NeuformIsolatedEffectProps & {
  variant?: RecursiveErosionVariant;
  speed?: number;
  pointSize?: number;
  wavelength?: number;
}) {
  const style = RECURSIVE_EROSION_STYLES[variant] ?? RECURSIVE_EROSION_STYLES[RECURSIVE_EROSION_DEFAULTS.variant];
  const definition = useMemo<EffectDefinition>(() => ({
    ...EFFECTS.recursiveErosion,
    title: style.title,
    background: style.darkBackground,
    theme: { lightBackground: style.lightBackground, darkBackground: style.darkBackground },
    transformSource: (source) => transformRecursiveErosionSource(source, style),
  }), [style]);
  const runtime = useMemo(() => ({
    speed: clamp(speed, 0, 3),
    pointSize: clamp(pointSize, 0.35, 2.5),
    wavelength: clamp(wavelength, 0.4, 2.5),
  }), [speed, pointSize, wavelength]);

  return <NeuformIsolatedEffect {...props} definition={definition} runtime={runtime} />;
}
export const ThreeUIIntro = createEffectComponent(EFFECTS.threeUIIntro);
export const ParticleWordmark = createEffectComponent(EFFECTS.particleWordmark);
export const AudioWordmark = createEffectComponent(EFFECTS.audioWordmark);
export function GalleryHeading({
  variant = GALLERY_HEADING_DEFAULTS.variant,
  font,
  weight,
  headlineSize,
  ...props
}: NeuformIsolatedEffectProps & {
  variant?: GalleryHeadingVariant;
  font?: GalleryHeadingFont;
  weight?: GalleryHeadingWeight;
  headlineSize?: number;
}) {
  const configuration = GALLERY_HEADING_VARIANTS[variant] ?? GALLERY_HEADING_VARIANTS[GALLERY_HEADING_DEFAULTS.variant];
  const definition = useMemo<EffectDefinition>(() => ({
    ...EFFECTS.galleryHeading,
    title: `${configuration.title} canvas animation`,
    transformSource: (source, mode) => transformGalleryHeadingSource(source, mode, configuration),
  }), [configuration]);
  /* typography rides the live channel: a rebuilt srcDoc would repaint every
     tile texture and restart the ring on each control tick. Leaving a prop out
     keeps the face this gallery was drawn with rather than a global default. */
  const runtime = useMemo(() => {
    const type = configuration.type;
    const resolvedWeight = weight && GALLERY_HEADING_WEIGHTS.includes(weight) ? weight : type.weight;
    return {
      font: (font && GALLERY_HEADING_FONTS[font]) ?? GALLERY_HEADING_FONTS[type.font],
      weight: resolvedWeight,
      headlineSize: clamp(headlineSize ?? type.headlineSize, 0.6, 1.8),
    };
  }, [configuration, font, headlineSize, weight]);

  return <NeuformIsolatedEffect {...props} definition={definition} runtime={runtime} trackPointerHover />;
}

/** @deprecated Use GalleryHeading. */
export const GradientCollection = GalleryHeading;
export const DimensionalField = createEffectComponent(EFFECTS.dimensional);
export const CloudField = createEffectComponent(EFFECTS.cloud);
export const DataField = createEffectComponent(EFFECTS.vertex9);
export const TopologyField = createEffectComponent(EFFECTS.topology);
export const VoidField = createEffectComponent(EFFECTS.voidField);
