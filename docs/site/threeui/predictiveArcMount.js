/**
 * Vanilla mount for ThreeUI PredictiveArcCanvas (variant: predictive).
 * Renderer: exact port of predictiveArcRenderer.ts.
 * Pointer/scroll dynamics are intentionally subtle.
 */
import {
  createPredictiveArcRenderer,
  PREDICTIVE_ARC_DEFAULTS,
} from "./predictiveArcRenderer.js";

export const PREDICTIVE_ARC_USAGE = {
  mode: "dark",
  speed: 0.85,
  hue: -46,
  saturation: 1.35,
  brightness: 1.15,
};

export function mountPredictiveArc(host, props = PREDICTIVE_ARC_USAGE) {
  if (!host) return () => {};
  const base = { ...PREDICTIVE_ARC_DEFAULTS, ...props };
  host.className = `threeui-background predictive-arc predictive-arc--${base.mode}${host.className ? ` ${host.className}` : ""}`.trim();
  host.dataset.mode = base.mode;

  let canvas = host.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    host.appendChild(canvas);
  }
  const applyFilter = (hue, saturation) => {
    canvas.style.filter = `hue-rotate(${hue}deg) saturate(${saturation})`;
  };
  applyFilter(base.hue, base.saturation);

  const optionsRef = { current: { ...base } };
  const renderer = createPredictiveArcRenderer(canvas, () => optionsRef.current);
  if (!renderer) return () => {};

  const heroSection =
    host.closest(".hero-cinematic") ||
    host.closest(".hero") ||
    host.closest("#signal") ||
    host.closest(".hero-media") ||
    host;

  let frame = 0;
  let visible = true;
  let lastScrollY = window.scrollY;
  let scrollBoost = 0;
  let pointerBoost = 0;
  let smoothBoost = 0;
  let pointerX = 0.5;
  let pointerY = 0.4;
  let lastPointerTs = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let pointerInside = false;

  const syncOptions = () => {
    const boost = smoothBoost;
    const archNudge = (pointerX - 0.5) * 0.1;
    const thickNudge = (0.5 - pointerY) * 0.14;
    optionsRef.current = {
      ...base,
      speed: base.speed + boost * 0.12,
      waveAmplitude: 1 + boost * 0.12,
      brightness: base.brightness + Math.min(0.18, boost * 0.1),
      thickness: Math.max(0.9, Math.min(1.15, (base.thickness || 1) + thickNudge + boost * 0.04)),
      archHeight: Math.max(0.58, Math.min(0.82, (base.archHeight || 0.7) + archNudge)),
      hue: base.hue + (pointerX - 0.5) * 6,
      saturation: base.saturation + Math.min(0.15, boost * 0.06),
    };
    applyFilter(optionsRef.current.hue, optionsRef.current.saturation);
  };

  const resize = () => {
    const bounds = host.getBoundingClientRect();
    renderer.resize(bounds.width, bounds.height);
    renderer.render();
  };

  const tick = () => {
    scrollBoost *= 0.95;
    pointerBoost *= pointerInside ? 0.94 : 0.91;
    if (scrollBoost < 0.01) scrollBoost = 0;
    if (pointerBoost < 0.01) pointerBoost = 0;
    smoothBoost += (Math.min(1, pointerBoost + scrollBoost * 0.15) - smoothBoost) * 0.08;
    syncOptions();
    renderer.render();
    frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0;
  };

  const onScroll = () => {
    const y = window.scrollY;
    const dy = Math.abs(y - lastScrollY);
    lastScrollY = y;
    scrollBoost = Math.min(0.9, scrollBoost + dy * 0.012);
  };

  const pointInHero = (clientX, clientY) => {
    const bounds = heroSection.getBoundingClientRect();
    return (
      clientX >= bounds.left &&
      clientX <= bounds.right &&
      clientY >= bounds.top &&
      clientY <= bounds.bottom
    );
  };

  const onPointerMove = (event) => {
    const clientX = event.clientX;
    const clientY = event.clientY;
    if (!pointInHero(clientX, clientY)) {
      if (pointerInside) {
        pointerInside = false;
        lastPointerTs = 0;
      }
      return;
    }
    pointerInside = true;
    const bounds = heroSection.getBoundingClientRect();
    pointerX = Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width)));
    pointerY = Math.max(0, Math.min(1, (clientY - bounds.top) / Math.max(1, bounds.height)));

    const now = performance.now();
    if (lastPointerTs) {
      const dt = Math.max(8, now - lastPointerTs);
      const dist = Math.hypot(clientX - lastPointerX, clientY - lastPointerY);
      pointerBoost = Math.min(1, (dist / dt) / 1.8);
    } else {
      pointerBoost = Math.min(0.25, pointerBoost + 0.05);
    }
    lastPointerTs = now;
    lastPointerX = clientX;
    lastPointerY = clientY;
  };

  const onPointerLeaveWindow = () => {
    pointerInside = false;
    lastPointerTs = 0;
  };

  const observer = new ResizeObserver(resize);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    if (visible && !frame) frame = requestAnimationFrame(tick);
    if (!visible && frame) cancelAnimationFrame(frame), (frame = 0);
  });
  const visibility = () => {
    if (document.hidden && frame) cancelAnimationFrame(frame), (frame = 0);
    else if (!document.hidden && visible && !frame) frame = requestAnimationFrame(tick);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerMove, { passive: true });
  window.addEventListener("blur", onPointerLeaveWindow);
  document.addEventListener("mouseleave", onPointerLeaveWindow);

  observer.observe(host);
  intersection.observe(host);
  document.addEventListener("visibilitychange", visibility);
  syncOptions();
  resize();
  frame = requestAnimationFrame(tick);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerMove);
    window.removeEventListener("blur", onPointerLeaveWindow);
    document.removeEventListener("mouseleave", onPointerLeaveWindow);
  };
}

export function autoMountPredictiveArc(selector = "[data-predictive-arc]") {
  const host = document.querySelector(selector);
  if (!host) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    host.classList.add("threeui-background", "predictive-arc", "predictive-arc--dark", "is-static");
    host.dataset.mode = "dark";
    return;
  }
  mountPredictiveArc(host, PREDICTIVE_ARC_USAGE);
}
