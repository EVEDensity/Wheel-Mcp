import { makeDeck, pickFood, advanceSnake, canTurn, circleHitsRect } from './game-core.js';
const page = document.querySelector('[data-game]');
const game = page.dataset.game;
const canvas = document.querySelector('#game-canvas');
const ctx = canvas?.getContext('2d');
const overlay = document.querySelector('#game-overlay');
const title = document.querySelector('#overlay-title');
const description = document.querySelector('#overlay-description');
const startButton = document.querySelector('#start-game');
const pauseButton = document.querySelector('#pause-game');
const status = document.querySelector('#game-status');
const scoreEl = document.querySelector('#score');
const bestEl = document.querySelector('#best');
const keys = new Set();
const isMemory = game === 'signal-match';
let state = 'ready',
  score = 0,
  elapsed = 0,
  lastTime = 0,
  best = null;
let paddle, ball, bricks, lives, serveTime;
let snake, direction, nextDirection, food, snakeTime;
let deck = [],
  flipped = [],
  matched = new Set(),
  matchWait = 0;
try {
  const stored = localStorage.getItem(`wheel-best-${game}`);
  if (stored !== null && Number.isFinite(Number(stored))) best = Number(stored);
} catch {
  /* Private browsing can disable storage. */
}
function updateScore() {
  scoreEl.textContent = `${isMemory ? '步数' : '得分'} ${score}`;
  bestEl.textContent = `最佳 ${best === null ? '—' : best}`;
}
function saveBest(won) {
  if (isMemory && !won) return;
  if (best === null || (isMemory ? score < best : score > best)) {
    best = score;
    try {
      localStorage.setItem(`wheel-best-${game}`, String(best));
    } catch {
      /* Play still works without storage. */
    }
  }
  updateScore();
}
function setOverlay(heading, detail, action) {
  title.textContent = heading;
  description.textContent = detail;
  startButton.textContent = action;
  overlay.hidden = false;
}
function end(won) {
  state = 'ended';
  keys.clear();
  pauseButton.disabled = true;
  saveBest(won);
  const message = `${isMemory ? '总步数' : '最终得分'} ${score} · 用时 ${Math.floor(elapsed)} 秒`;
  setOverlay(won ? '完成得漂亮！' : '再试一次？', message, '再玩一次 ↻');
  status.textContent = won ? `已完成 · ${message}` : `游戏结束 · ${message}`;
  startButton.focus({ preventScroll: true });
}
function pause() {
  if (state !== 'playing') return;
  state = 'paused';
  keys.clear();
  setOverlay('暂停一下', '你的进度还在，准备好后继续。', '继续游戏 ▷');
  pauseButton.textContent = '继续';
  status.textContent = '已暂停';
  startButton.focus({ preventScroll: true });
}
function resume() {
  state = 'playing';
  overlay.hidden = true;
  pauseButton.textContent = '暂停';
  status.textContent = '游戏进行中';
  if (canvas) canvas.focus({ preventScroll: true });
  else document.querySelector('.memory-card:not(:disabled)')?.focus({ preventScroll: true });
}
function resetBall() {
  ball = { x: paddle.x + paddle.w / 2, y: 460, vx: 220, vy: -315, r: 8 };
  serveTime = 0.9;
}
function start() {
  score = 0;
  elapsed = 0;
  keys.clear();
  pauseButton.disabled = false;
  if (game === 'orbit-breaker') {
    paddle = { x: 410, y: 490, w: 140, h: 12 };
    bricks = Array.from({ length: 32 }, (_, i) => ({
      x: 66 + (i % 8) * 105,
      y: 60 + Math.floor(i / 8) * 35,
      w: 94,
      h: 22,
      alive: true,
      row: Math.floor(i / 8),
    }));
    lives = 3;
    resetBall();
  } else if (game === 'circuit-snake') {
    snake = [
      { x: 7, y: 7 },
      { x: 6, y: 7 },
      { x: 5, y: 7 },
    ];
    direction = nextDirection = { x: 1, y: 0 };
    // A reachable opening signal makes the controls immediately legible.
    food = { x: 11, y: 7 };
    snakeTime = 0;
  } else {
    deck = makeDeck();
    flipped = [];
    matched = new Set();
    matchWait = 0;
    const board = document.querySelector('#memory-board');
    board.replaceChildren(
      ...deck.map((_, index) => {
        const button = document.createElement('button');
        button.className = 'memory-card';
        button.textContent = '✧';
        button.setAttribute('aria-label', `卡片 ${index + 1}，未翻开`);
        button.addEventListener('click', () => flip(index));
        return button;
      }),
    );
  }
  updateScore();
  resume();
  render();
}
function flip(index) {
  if (state !== 'playing' || matched.has(index) || flipped.includes(index) || flipped.length === 2) return;
  flipped.push(index);
  renderCards();
  if (flipped.length === 2) {
    score++;
    updateScore();
    matchWait = 0.75;
  }
}
function renderCards() {
  document.querySelectorAll('.memory-card').forEach((button, index) => {
    const shown = flipped.includes(index) || matched.has(index);
    button.textContent = shown ? deck[index] : '✧';
    button.classList.toggle('revealed', shown);
    button.classList.toggle('matched', matched.has(index));
    button.disabled = matched.has(index);
    button.setAttribute(
      'aria-label',
      `卡片 ${index + 1}，${matched.has(index) ? '已配对 ' + deck[index] : shown ? deck[index] : '未翻开'}`,
    );
  });
}
function turn(name) {
  const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  if (state === 'playing' && game === 'circuit-snake' && canTurn(direction, map[name])) nextDirection = map[name];
}
function update(dt) {
  elapsed += dt;
  if (isMemory) {
    if (matchWait > 0) {
      matchWait -= dt;
      if (matchWait <= 0) {
        if (deck[flipped[0]] === deck[flipped[1]]) flipped.forEach((index) => matched.add(index));
        flipped = [];
        renderCards();
        if (matched.size === 16) end(true);
      }
    }
    return;
  }
  if (game === 'circuit-snake') {
    snakeTime += dt;
    const interval = Math.max(0.075, 0.18 - score * 0.002);
    if (snakeTime >= interval) {
      snakeTime -= interval;
      direction = nextDirection;
      const result = advanceSnake(snake, direction, food);
      if (result.dead) {
        end(false);
        return;
      }
      snake = result.body;
      if (result.ate) {
        score += 10;
        food = pickFood(snake);
        updateScore();
        if (!food) end(true);
      }
    }
    return;
  }
  const move = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
  paddle.x = Math.max(10, Math.min(950 - paddle.w, paddle.x + move * 620 * dt));
  if (serveTime > 0) {
    serveTime -= dt;
    ball.x = paddle.x + paddle.w / 2;
    return;
  }
  // Small substeps keep high-speed collisions from skipping thin bricks.
  for (let sub = 0; sub < 4; sub++) {
    const previousY = ball.y;
    ball.x += (ball.vx * dt) / 4;
    ball.y += (ball.vy * dt) / 4;
    if (ball.x < ball.r || ball.x > 960 - ball.r) {
      ball.x = Math.max(ball.r, Math.min(960 - ball.r, ball.x));
      ball.vx *= -1;
    }
    if (ball.y < ball.r) {
      ball.y = ball.r;
      ball.vy = Math.abs(ball.vy);
    }
    if (ball.vy > 0 && circleHitsRect(ball, paddle)) {
      ball.y = paddle.y - ball.r;
      const aim = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
      const speed = Math.min(540, Math.hypot(ball.vx, ball.vy) + 6);
      ball.vx = aim * speed * 0.82;
      ball.vy = -Math.sqrt(speed * speed - ball.vx * ball.vx);
    }
    for (const brick of bricks) {
      if (!brick.alive || !circleHitsRect(ball, brick)) continue;
      brick.alive = false;
      score += 10;
      updateScore();
      if (previousY + ball.r <= brick.y || previousY - ball.r >= brick.y + brick.h) ball.vy *= -1;
      else ball.vx *= -1;
      if (bricks.every((b) => !b.alive)) {
        end(true);
        return;
      }
      break;
    }
    if (ball.y > 560) {
      lives--;
      if (!lives) {
        end(false);
        return;
      }
      resetBall();
      break;
    }
  }
}
function background() {
  ctx.fillStyle = '#111a14';
  ctx.fillRect(0, 0, 960, 540);
  ctx.strokeStyle = '#273528';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 960; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 540);
    ctx.stroke();
  }
  for (let y = 0; y <= 540; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(960, y);
    ctx.stroke();
  }
}
function render() {
  if (!ctx) return;
  background();
  if (game === 'orbit-breaker' && paddle) {
    const colors = ['#c6e98c', '#a3c17a', '#7f9e63', '#56754d'];
    for (const brick of bricks)
      if (brick.alive) {
        ctx.fillStyle = colors[brick.row];
        ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
      }
    ctx.fillStyle = '#d1efa4';
    ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9caf8c';
    ctx.font = '13px monospace';
    ctx.fillText(`LIVES ${'● '.repeat(lives)}`, 25, 526);
    ctx.fillText(`${bricks.filter((b) => !b.alive).length} / 32`, 850, 526);
    if (serveTime > 0) {
      ctx.textAlign = 'center';
      ctx.fillText('GET READY', 480, 320);
      ctx.textAlign = 'left';
    }
  } else if (game === 'circuit-snake' && snake) {
    const cell = 34,
      ox = 72,
      oy = 32;
    ctx.strokeStyle = '#6b8860';
    ctx.strokeRect(ox - 3, oy - 3, 24 * cell + 6, 14 * cell + 6);
    snake.forEach((part, i) => {
      ctx.fillStyle = i === 0 ? '#d1efac' : '#7d9f68';
      ctx.fillRect(ox + part.x * cell + 2, oy + part.y * cell + 2, cell - 4, cell - 4);
    });
    if (food) {
      ctx.fillStyle = '#e5c77e';
      ctx.beginPath();
      ctx.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function frame(now) {
  const dt = Math.min((now - lastTime) / 1000 || 0, 0.035);
  lastTime = now;
  if (state === 'playing') {
    update(dt);
    render();
  }
  requestAnimationFrame(frame);
}
startButton.addEventListener('click', () => (state === 'paused' ? resume() : start()));
pauseButton.addEventListener('click', () => (state === 'paused' ? resume() : pause()));
document.querySelector('#restart-game').addEventListener('click', start);
document
  .querySelectorAll('[data-direction]')
  .forEach((button) => button.addEventListener('click', () => turn(button.dataset.direction)));
document.addEventListener('keydown', (event) => {
  if (state !== 'playing') return;
  if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
    event.preventDefault();
    pause();
    return;
  }
  const map = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    s: 'down',
    a: 'left',
    d: 'right',
  };
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (!isMemory && map[key]) {
    event.preventDefault();
    keys.add(key);
    turn(map[key]);
  }
});
document.addEventListener('keyup', (event) =>
  keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key),
);
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
if (game === 'orbit-breaker') {
  canvas.addEventListener('pointermove', (event) => {
    if (state !== 'playing') return;
    const rect = canvas.getBoundingClientRect();
    paddle.x = Math.max(10, Math.min(950 - paddle.w, ((event.clientX - rect.left) / rect.width) * 960 - paddle.w / 2));
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (state === 'playing') {
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    }
  });
}
const fullscreen = document.querySelector('#fullscreen');
if (!document.fullscreenEnabled) fullscreen.hidden = true;
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.querySelector('#player').requestFullscreen();
  } catch {
    status.textContent = '浏览器未允许全屏；仍可在当前页面游玩。';
  }
});
document.addEventListener('fullscreenchange', () =>
  fullscreen.setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '全屏游戏'),
);
updateScore();
render();
requestAnimationFrame(frame);
