const steps = [
  [
    'get_context_pack',
    '{\n  "projectPath": "/your/game",\n  "scenePath": "res://main.tscn"\n}',
    '先读懂项目结构，再决定下一步。',
  ],
  [
    'call_runtime_bridge',
    '{\n  "sessionId": "<session-id>",\n  "method": "wait_physics_frames",\n  "params": { "frames": 12 }\n}',
    '在已打开的会话中，等待明确的物理帧。',
  ],
  [
    'dev_loop',
    '{\n  "projectPath": "/your/game",\n  "bridgePath": "/path/to/runtime_bridge.gd",\n  "evidenceDir": "/your/evidence",\n  "checks": [],\n  "screenshot": true\n}',
    '简化结构示意；请在正式验证时填写行为断言。',
  ],
];
function showStep(index) {
  const [title, code, caption] = steps[index];
  document.querySelector('#code-title').textContent = title;
  document.querySelector('#workflow-code').textContent = code;
  document.querySelector('#code-caption').textContent = caption;
  document.querySelectorAll('[data-step]').forEach((button) => {
    const active = Number(button.dataset.step) === index;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
if (document.querySelector('#workflow-code')) showStep(0);
document
  .querySelectorAll('[data-step]')
  .forEach((button) => button.addEventListener('click', () => showStep(Number(button.dataset.step))));
document.querySelectorAll('[data-filter]').forEach((button) =>
  button.addEventListener('click', () => {
    let count = 0;
    document.querySelectorAll('[data-category]').forEach((card) => {
      card.hidden = button.dataset.filter !== 'all' && card.dataset.category !== button.dataset.filter;
      if (!card.hidden) count++;
    });
    document.querySelectorAll('[data-filter]').forEach((item) => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
    document.querySelector('#filter-count').textContent = `${count} 个展位`;
  }),
);
document.querySelectorAll('[data-copy]').forEach((button) =>
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent.trim());
      button.textContent = '已复制 ✓';
    } catch {
      button.textContent = '请选中下方命令复制';
    }
  }),
);

// Cinematic landing interactions
(() => {
  const body = document.body;
  if (!body?.classList.contains('landing-page')) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const progress = document.querySelector('.scroll-progress span');
  const updateProgress = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
  };
  updateProgress();
  window.addEventListener('scroll', updateProgress, { passive: true });

  const revealItems = document.querySelectorAll('.reveal');
  if (!reduced && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            observer.unobserve(entry.target);
          }
        }),
      { threshold: 0.12 },
    );
    revealItems.forEach((item) => observer.observe(item));
  } else revealItems.forEach((item) => item.classList.add('revealed'));

  const canvas = document.querySelector('#ambient-canvas');
  const ctx = canvas?.getContext('2d');
  if (canvas && ctx && !reduced) {
    const particles = [];
    const resize = () => {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };
    const seed = () => {
      particles.length = 0;
      const amount = Math.min(70, Math.floor(window.innerWidth / 18));
      for (let i = 0; i < amount; i++)
        particles.push({
          x: Math.random() * innerWidth,
          y: Math.random() * innerHeight,
          r: Math.random() * 1.7 + 0.25,
          vx: (Math.random() - 0.5) * 0.11,
          vy: (Math.random() - 0.5) * 0.08,
          a: Math.random() * 0.45 + 0.08,
          teal: Math.random() > 0.45,
        });
    };
    const draw = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -5) p.x = innerWidth + 5;
        if (p.x > innerWidth + 5) p.x = -5;
        if (p.y < -5) p.y = innerHeight + 5;
        if (p.y > innerHeight + 5) p.y = -5;
        ctx.fillStyle = p.teal ? `rgba(94,234,212,${p.a})` : `rgba(96,165,250,${p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(draw);
    };
    resize();
    seed();
    window.addEventListener('resize', () => {
      resize();
      seed();
    });
    draw();
  }

  // Hero procedural tech canvas + optional video
  const heroMedia = document.querySelector('.hero-media');
  const heroVideo = document.querySelector('.hero-video');
  const heroCanvas = document.querySelector('#hero-tech-canvas');
  const heroCtx = heroCanvas?.getContext('2d');
  if (heroVideo) {
    const markMissing = () => heroVideo.classList.add('is-missing');
    heroVideo.addEventListener('error', markMissing);
    heroVideo.addEventListener('loadeddata', () => {
      heroVideo.classList.remove('is-missing');
      heroVideo.play?.().catch(() => {});
    });
    const src = heroVideo.dataset.heroVideo;
    if (src) {
      fetch(src, { method: 'HEAD' })
        .then((res) => {
          if (!res.ok) throw new Error('missing');
          heroVideo.src = src;
          return heroVideo.play?.();
        })
        .catch(() => markMissing());
    } else {
      markMissing();
    }
  }

  if (heroCanvas && heroCtx) {
    let nodes = [];
    let running = false;
    let visible = true;
    let raf = 0;
    const resizeHero = () => {
      const rect = heroMedia?.getBoundingClientRect() || { width: innerWidth, height: innerHeight };
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(320, Math.floor(rect.height));
      heroCanvas.width = w * devicePixelRatio;
      heroCanvas.height = h * devicePixelRatio;
      heroCanvas.style.width = `${w}px`;
      heroCanvas.style.height = `${h}px`;
      heroCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      nodes = Array.from({ length: Math.min(42, Math.floor(w / 38)) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.8 + 0.8,
        pulse: Math.random() * Math.PI * 2,
      }));
    };
    const drawHero = (t) => {
      if (!running) return;
      const w = heroCanvas.clientWidth;
      const h = heroCanvas.clientHeight;
      heroCtx.clearRect(0, 0, w, h);
      heroCtx.fillStyle = '#07080c';
      heroCtx.fillRect(0, 0, w, h);

      const grid = 48;
      heroCtx.strokeStyle = 'rgba(94,234,212,0.05)';
      heroCtx.lineWidth = 1;
      for (let x = 0; x <= w; x += grid) {
        heroCtx.beginPath();
        heroCtx.moveTo(x, 0);
        heroCtx.lineTo(x, h);
        heroCtx.stroke();
      }
      for (let y = 0; y <= h; y += grid) {
        heroCtx.beginPath();
        heroCtx.moveTo(0, y);
        heroCtx.lineTo(w, y);
        heroCtx.stroke();
      }

      const gx = w * 0.72;
      const gy = h * 0.42;
      const glow = heroCtx.createRadialGradient(gx, gy, 20, gx, gy, Math.max(w, h) * 0.42);
      glow.addColorStop(0, 'rgba(96,165,250,0.18)');
      glow.addColorStop(0.45, 'rgba(94,234,212,0.08)');
      glow.addColorStop(1, 'transparent');
      heroCtx.fillStyle = glow;
      heroCtx.fillRect(0, 0, w, h);

      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.pulse += 0.02;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < 140) {
            heroCtx.strokeStyle = `rgba(94,234,212,${0.12 * (1 - d / 140)})`;
            heroCtx.beginPath();
            heroCtx.moveTo(a.x, a.y);
            heroCtx.lineTo(b.x, b.y);
            heroCtx.stroke();
          }
        }
      }
      for (const n of nodes) {
        const alpha = 0.35 + Math.sin(n.pulse + t * 0.001) * 0.2;
        heroCtx.fillStyle = `rgba(96,165,250,${alpha})`;
        heroCtx.beginPath();
        heroCtx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        heroCtx.fill();
        heroCtx.strokeStyle = `rgba(94,234,212,${alpha * 0.8})`;
        heroCtx.beginPath();
        heroCtx.arc(n.x, n.y, n.r + 4, 0, Math.PI * 2);
        heroCtx.stroke();
      }
      raf = requestAnimationFrame(drawHero);
    };
    const start = () => {
      if (running || reduced || !visible) return;
      running = true;
      raf = requestAnimationFrame(drawHero);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    resizeHero();
    window.addEventListener('resize', resizeHero);
    if ('IntersectionObserver' in window && heroMedia) {
      const io = new IntersectionObserver(
        (entries) => {
          visible = entries.some((e) => e.isIntersecting);
          if (visible) start();
          else stop();
        },
        { threshold: 0.05 },
      );
      io.observe(heroMedia);
    }
    if (!reduced) start();
    else {
      resizeHero();
      drawHero(0);
      stop();
    }
  }

  // Hero media scroll scale / opacity
  if (heroMedia && !reduced) {
    const onScrollHero = () => {
      const hero = document.querySelector('.hero-cinematic');
      if (!hero) return;
      const rect = hero.getBoundingClientRect();
      const progressY = Math.min(1, Math.max(0, -rect.top / Math.max(rect.height, 1)));
      const scale = 1 + progressY * 0.08;
      const opacity = 1 - progressY * 0.45;
      heroMedia.style.transform = `scale(${scale})`;
      heroMedia.style.opacity = String(Math.max(0.35, opacity));
    };
    onScrollHero();
    window.addEventListener('scroll', onScrollHero, { passive: true });
  }

  // Bento spotlight
  document.querySelectorAll('.bento-card').forEach((card) => {
    if (reduced) return;
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    });
  });

  const tilt = document.querySelector('[data-tilt]');
  if (tilt && !reduced) {
    tilt.addEventListener('pointermove', (event) => {
      const rect = tilt.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      tilt.style.transform = `perspective(1300px) rotateX(${y * -3}deg) rotateY(${x * 4}deg)`;
    });
    tilt.addEventListener('pointerleave', () => {
      tilt.style.transform = '';
    });
  }
  document.querySelectorAll('.magnetic').forEach((button) => {
    if (reduced) return;
    button.addEventListener('pointermove', (event) => {
      const rect = button.getBoundingClientRect();
      button.style.transform = `translate(${(event.clientX - rect.left - rect.width / 2) * 0.12}px, ${(event.clientY - rect.top - rect.height / 2) * 0.18}px)`;
    });
    button.addEventListener('pointerleave', () => {
      button.style.transform = '';
    });
  });

  const outputs = [
    ['PROJECT UNDERSTOOD', '上下文已经装载。下一步，可以放心行动。'],
    ['INPUT RECEIVED', '运行时正在回应。状态不是猜的，是读出来的。'],
    ['EVIDENCE CAPTURED', '断言通过。截图、日志与修改，留下完整轨迹。'],
  ];
  const outputTitle = document.querySelector('#machine-output-title');
  const outputCopy = document.querySelector('#machine-output-copy');
  const rail = document.querySelector('.rail-progress');
  document.querySelectorAll('[data-machine-step]').forEach((step) =>
    step.addEventListener('click', () => {
      const index = Number(step.dataset.machineStep);
      document
        .querySelectorAll('[data-machine-step]')
        .forEach((item) => item.classList.toggle('active', item === step));
      if (outputTitle) outputTitle.textContent = outputs[index][0];
      if (outputCopy) outputCopy.textContent = outputs[index][1];
      if (rail) rail.style.width = `${index * 50}%`;
    }),
  );

  const modal = document.querySelector('#game-modal');
  const frame = document.querySelector('#game-frame');
  const frameWrap = document.querySelector('.modal-frame-wrap');
  const close = () => {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    if (frame) {
      frame.src = 'about:blank';
      frameWrap?.classList.remove('loaded');
    }
  };
  const open = () => {
    if (!modal || !frame) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    frame.src = frame.dataset.src;
    frame.addEventListener('load', () => frameWrap?.classList.add('loaded'), { once: true });
    document.querySelector('.modal-close')?.focus({ preventScroll: true });
  };
  document.querySelectorAll('[data-game-modal]').forEach((trigger) =>
    trigger.addEventListener('click', (event) => {
      if (trigger.matches('.play-console')) {
        event.preventDefault();
      }
      open();
    }),
  );
  document.querySelectorAll('[data-close-modal]').forEach((trigger) => trigger.addEventListener('click', close));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) close();
  });
})();

(() => {
  const root = document.querySelector('[data-agent-carousel]');
  if (!root) return;
  const cards = [...root.querySelectorAll('.agent-card:not([data-agent-set="clone"])')];
  const name = document.querySelector('#active-agent-name');
  const mode = document.querySelector('#active-agent-mode');
  let index = 0;
  let timer;
  const activate = (next) => {
    index = (next + cards.length) % cards.length;
    cards.forEach((card, cardIndex) => {
      const active = cardIndex === index;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-current', active ? 'true' : 'false');
    });
    const activeCard = cards[index];
    if (name) name.textContent = activeCard.dataset.agentName || activeCard.textContent.trim();
    if (mode) mode.textContent = activeCard.dataset.agentMode || 'MCP profile';
  };
  const start = () => {
    window.clearInterval(timer);
    if (root.matches(':hover, :focus-within') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = window.setInterval(() => activate(index + 1), 2400);
  };
  cards.forEach((card, cardIndex) => {
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('pointerenter', () => activate(cardIndex));
    card.addEventListener('focus', () => { window.clearInterval(timer); activate(cardIndex); });
    card.addEventListener('click', () => {
      activate(cardIndex);
      start();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate(cardIndex);
        start();
      }
    });
  });
  root.addEventListener('mouseenter', () => window.clearInterval(timer));
  root.addEventListener('mouseleave', start);
  root.addEventListener('focusout', () => setTimeout(start, 0));
  activate(0);
  start();
})();
