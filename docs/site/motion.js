// Progressive enhancement: content remains visible if JavaScript is unavailable.
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const running = new Set();
function animate(element, from, delay = 0) {
  if (!element || reduced.matches) return;
  const animation = element.animate([from, { opacity: 1, transform: 'none', clipPath: 'inset(0)' }], {
    duration: 800, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards'
  });
  running.add(animation);
  animation.finished.catch(() => {}).finally(() => running.delete(animation));
}
const recipes = {
  verify: [['.heading', { opacity: 0, transform: 'translateY(36px)' }], ['.lab-view', { opacity: 0, transform: 'translateX(-28px)' }], ['.results', { opacity: 0, transform: 'translateX(28px)' }]],
  agents: [['.heading', { opacity: 0, transform: 'translateX(-36px)' }], ['.client-slider', { opacity: 0, clipPath: 'inset(0 100% 0 0)' }], ['.client-options', { opacity: 0, transform: 'translateY(30px)' }], ['.instructions', { opacity: 0, transform: 'translateY(40px)' }]],
  advantages: [['h2', { opacity: 0, transform: 'translateY(26px)' }], ['.number', { opacity: 0, transform: 'scale(.92)' }], ['.efficiency-bottom', { opacity: 0, clipPath: 'inset(0 100% 0 0)' }]],
  start: [['h2', { opacity: 0, transform: 'translateY(40px)' }], ['.start-bottom', { opacity: 0, transform: 'scale(.96) translateY(24px)' }]]
};
// Observe individual blocks: lower content is not animated off-screen on phones.
const observer = new IntersectionObserver(entries => entries.forEach(entry => {
  if (!entry.isIntersecting) return;
  const { from, delay } = entry.target.motionRecipe;
  animate(entry.target, from, delay);
  observer.unobserve(entry.target);
}), { threshold: .12 });
Object.entries(recipes).forEach(([id, blocks]) => blocks.forEach(([selector, from], i) => {
  const element = document.querySelector(`#${id} ${selector}`);
  element.motionRecipe = { from, delay: i * 65 };
  observer.observe(element);
}));
reduced.addEventListener('change', () => { if (reduced.matches) running.forEach(a => a.cancel()); });

const progress = document.createElement('div');
progress.className = 'reading-progress';
progress.setAttribute('aria-hidden', 'true');
document.body.append(progress);
let pending = false;
function updateProgress() {
  const height = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${height > 0 ? Math.min(1, Math.max(0, scrollY / height)) : 0})`;
  pending = false;
}
addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(updateProgress); } }, { passive: true });
addEventListener('resize', updateProgress);
updateProgress();

document.querySelectorAll('[data-client]').forEach(button => button.addEventListener('click', () => {
  const panel = document.querySelector('.instructions');
  panel.getAnimations().forEach(a => a.cancel());
  animate(panel, { opacity: .35, transform: 'translateY(12px)' });
}));
