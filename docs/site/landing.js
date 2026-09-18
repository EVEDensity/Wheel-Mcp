import { t } from './i18n.js';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const film = document.querySelector('#film');
let wanted = !reduced.matches, filmVisible = false;
function syncFilm() { if (wanted && filmVisible && !document.hidden) film.play().catch(() => {}); else film.pause(); }
if (!wanted) film.pause();
new IntersectionObserver(([entry]) => { filmVisible = entry.isIntersecting; syncFilm(); }, { threshold: .1 }).observe(film);
document.addEventListener('visibilitychange', syncFilm);
reduced.addEventListener('change', () => { wanted = !reduced.matches; syncFilm(); });
document.querySelectorAll('[data-select-client]').forEach(button => button.addEventListener('click', () => {
 document.querySelector('[data-client="' + button.dataset.selectClient + '"]').click();
}));
const profiles = {
codex: ['CODEX / GLOBAL CONFIGURATION', t('在仓库根目录运行安装命令，完成后重启 Codex。'), 'npm.cmd run go:global', t('调用 get_godot_version，确认 Godot 已连接。')],
cursor: ['CURSOR / GLOBAL + PROJECT', t('在仓库根目录运行安装命令，完成后重启 Cursor。'), 'npm.cmd run go:global', t('在 MCP 工具列表中确认 wheel-mcp，再检查 Godot 版本。')],
claude: ['CLAUDE CODE / PROJECT PROFILE', t('在仓库根目录运行项目级安装，随后重新启动 Claude Code 会话。'), 'npm.cmd run go', t('确认项目 MCP 配置已加载，再调用 get_godot_version。')],
other: ['STANDARD MCP / STDIO', t('先安装并构建仓库，再配置 stdio MCP 服务。请替换为实际路径。'), t('node <仓库绝对路径>/build/src/mcp-server-sdk.js'), t('配置 GODOT_PATH。详细字段与平台说明见接入指南。')]
};
document.querySelectorAll('[data-client]').forEach(button => button.addEventListener('click', () => {
 document.querySelectorAll('[data-client]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
 ['client-tag','client-description','client-command','client-after'].forEach((id,i) => document.getElementById(id).textContent = t(profiles[button.dataset.client][i]));
}));
let feedbackTimer;
document.querySelectorAll('[data-copy]').forEach(button => {
 const label = button.textContent;
 let timer;
 button.addEventListener('click', async () => {
  clearTimeout(timer);
  const feedback = document.querySelector('#copy-feedback');
  try {
   await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent.trim());
   button.textContent = t('已复制 ✓'); feedback.textContent = t('命令已复制，可粘贴到终端运行');
  } catch { button.textContent = t('请选中命令复制'); feedback.textContent = t('无法访问剪贴板，请手动选择并复制命令'); }
  clearTimeout(feedbackTimer); feedbackTimer = setTimeout(() => feedback.textContent = '', 3000);
  timer = setTimeout(() => button.textContent = t(label), 2000);
 });
});
const run = document.querySelector('#run'), probe = document.querySelector('#probe'); let timers = [];
const step = (id,text) => { const item = document.getElementById(id); item.classList.add('done'); item.querySelector('p').textContent = text; };
function reset() {
 document.querySelector('#verify-next').hidden = true;
 document.querySelector('.lab').classList.remove('is-complete');
 run.textContent = t('发送输入并验证 ↗');
 timers.forEach(clearTimeout); timers = []; run.disabled = false; probe.classList.remove('arrived');
 ['input','state','assert'].forEach((id,i) => { document.getElementById(id).classList.remove('done'); document.querySelector('#'+id+' p').textContent = [t('等待 move_right 指令'),'position.x = 40',t('检查 position.x ≥ 240')][i]; });
 document.querySelector('#coordinate').textContent = 'position.x / 40'; document.querySelector('#lab-status').textContent = 'READY'; document.querySelector('#result').textContent = t('一次操作，一条清晰的验证路径。');
}
run.addEventListener('click', () => {
 reset(); run.disabled = true; run.textContent = t('正在验证…'); document.querySelector('#lab-status').textContent = 'RUNNING'; step('input',t('move_right → 已发送'));
 timers.push(setTimeout(() => probe.classList.add('arrived'),100));
 timers.push(setTimeout(() => { step('state','position.x = 240'); document.querySelector('#coordinate').textContent = 'position.x / 240'; },1150));
 timers.push(setTimeout(() => { step('assert','240 ≥ 240 → PASS'); document.querySelector('#lab-status').textContent = 'PASS'; document.querySelector('#result').textContent = t('✓ 示意验证通过：飞船已抵达目标位置。'); run.disabled = false; run.textContent = t('再体验一次 ↺'); document.querySelector('#verify-next').hidden = false; document.querySelector('.lab').classList.add('is-complete'); },1550));
}); document.querySelector('#reset').addEventListener('click', reset);
