export function makeDeck(random = Math.random) {
  const deck = [...'◈✳⌘△○✦□≋', ...'◈✳⌘△○✦□≋'];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
export function pickFood(body, width = 24, height = 14, random = Math.random) {
  const free = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!body.some((part) => part.x === x && part.y === y)) free.push({ x, y });
    }
  return free.length ? free[Math.floor(random() * free.length)] : null;
}
export function advanceSnake(body, direction, food, width = 24, height = 14) {
  const head = { x: body[0].x + direction.x, y: body[0].y + direction.y };
  const ate = !!food && head.x === food.x && head.y === food.y;
  const collisionBody = ate ? body : body.slice(0, -1);
  const dead =
    head.x < 0 ||
    head.y < 0 ||
    head.x >= width ||
    head.y >= height ||
    collisionBody.some((p) => p.x === head.x && p.y === head.y);
  if (dead) return { body, ate: false, dead: true };
  return { body: [head, ...(ate ? body : body.slice(0, -1))], ate, dead: false };
}
export function canTurn(current, next) {
  return current.x * next.x + current.y * next.y === 0;
}
export function circleHitsRect(ball, rect) {
  const x = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
  const y = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
  return (ball.x - x) ** 2 + (ball.y - y) ** 2 <= ball.r ** 2;
}
