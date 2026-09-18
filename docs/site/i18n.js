// Shared catalog for static content and live interaction messages.
export const messages = {
 '跳转到正文': 'Skip to content', '主导航': 'Main navigation', 'Wheel-mcp 首页': 'Wheel-mcp home',
 '探索': 'Explore', '体验': 'Try it', '接入': 'Connect', '安装': 'Install',
 '世界不该': 'Your world.', '停在想象里。': 'Beyond imagination.',
 'Wheel-mcp，让 AI 助手接入真实 Godot。': 'Wheel-mcp connects your AI assistant to a real Godot runtime.',
 '运行游戏、检查状态，验证每一次修改。': 'Run games. Inspect state. Verify every change.',
 '开始使用 ↗': 'Get started ↗', '探索一次验证 ↓': 'Try a verification ↓',
 '从「应该可以」，': 'From “it should work”', '到': 'to ', '「看见结果」。': '“here is the proof.”',
 '发送一次输入，看状态如何变化。': 'Send an input. Watch the state change.',
 '以下为浏览器交互示意，真实验证由 Godot 执行。': 'Interactive browser simulation. Actual verification runs in Godot.',
 '发送输入并验证 ↗': 'Send input & verify ↗', '重置 ↺': 'Reset ↺',
 '输入': 'Input', '状态': 'State', '断言': 'Assertion',
 '等待 move_right 指令': 'Waiting for move_right', '检查 position.x ≥ 240': 'Check position.x ≥ 240',
 '一次操作，一条清晰的验证路径。': 'One action. A clear trail of evidence.',
 '让你的 AI 也能这样做': 'Give your AI the same capability', '接入客户端 ↗': 'Connect your client ↗',
 '熟悉的助手。': 'Your familiar assistant.', '全新的行动力。': 'New powers to act.',
 '选择你的客户端，找到第一步。': 'Choose your client. Find your first step.',
 '滑动浏览客户端': 'Browse compatible clients', '选择客户端': 'Choose a client',
 '＋ 其他 MCP 客户端': '＋ Other MCP clients', '接进你的开发环境。': 'Connect your development environment.',
 '在仓库根目录运行安装命令，完成后重启 Codex。': 'Run the install command in the repository root, then restart Codex.',
 '调用 get_godot_version，确认 Godot 已连接。': 'Call get_godot_version to confirm your Godot connection.',
 '在仓库根目录运行安装命令，完成后重启 Cursor。': 'Run the install command in the repository root, then restart Cursor.',
 '在 MCP 工具列表中确认 wheel-mcp，再检查 Godot 版本。': 'Find wheel-mcp in your MCP tools, then check the Godot version.',
 '在仓库根目录运行项目级安装，随后重新启动 Claude Code 会话。': 'Run the project-level install in the repository root, then restart your Claude Code session.',
 '确认项目 MCP 配置已加载，再调用 get_godot_version。': 'Confirm the project MCP configuration is loaded, then call get_godot_version.',
 '先安装并构建仓库，再配置 stdio MCP 服务。请替换为实际路径。': 'Install and build the repository, then configure a stdio MCP server. Replace the placeholder with your actual path.',
 'node <仓库绝对路径>/build/src/mcp-server-sdk.js': 'node <absolute-repository-path>/build/src/mcp-server-sdk.js',
 '配置 GODOT_PATH。详细字段与平台说明见接入指南。': 'Set GODOT_PATH. See the setup guide for configuration fields and platform details.',
 '复制 ↗': 'Copy ↗', '完整接入指南 ↗': 'Full setup guide ↗',
 '把交互留给创造。': 'More room to create.', '把重复交给工具。': 'Less work on repeat.',
 '估算载荷 Token 减少': 'Reduction in estimated payload tokens', 'MCP 请求次数': 'MCP requests',
 '通过 dev_loop，把动作、断言和截图组织为一次调用。': 'Bundle actions, assertions, and screenshots into a single dev_loop call.',
 '查看测试报告 ↗': 'Read the benchmark ↗', '下一个世界，': 'Your next world.', '由你启动。': 'Starts with you.',
 '准备 Node.js ≥ 20.19.0 与 Godot。': 'Requires Node.js ≥ 20.19.0 and Godot.',
 '克隆、安装，让你的助手连接运行时。': 'Clone. Install. Connect your assistant to the runtime.',
 '在 GitHub 开始 ↗': 'Start on GitHub ↗', '复制命令 ↗': 'Copy commands ↗',
 '安装后重启客户端 · macOS / Linux 请查看接入指南': 'Restart your client after installation · For macOS / Linux, see the setup guide',
 '独立社区项目 · 非 Godot 官方产品': 'Independent community project · Not an official Godot product',
 '已复制 ✓': 'Copied ✓', '命令已复制，可粘贴到终端运行': 'Command copied. Paste it into your terminal to run.',
 '请选中命令复制': 'Select the command to copy', '无法访问剪贴板，请手动选择并复制命令': 'Clipboard unavailable. Please select and copy the command manually.',
 '正在验证…': 'Verifying…', 'move_right → 已发送': 'move_right → sent',
 '✓ 示意验证通过：飞船已抵达目标位置。': '✓ Simulation passed: the ship reached the target position.', '再体验一次 ↺': 'Try again ↺',
 'Wheel/mcp — 从想法，到运行。': 'Wheel/mcp — From idea to runtime.',
 'Wheel-mcp 连接 AI 与 Godot，让游戏修改可以运行、检查和验证。': 'Wheel-mcp connects AI and Godot to run, inspect, and verify game changes.'
};
for (const name of ['Codex', 'Cursor', 'Claude Code', 'Copilot', 'Windsurf', 'Trae']) {
 messages[`查看 ${name} 接入说明`] = `View ${name} setup instructions`;
}
const reverse = new Map(Object.entries(messages).map(([zh, en]) => [en.trim(), zh]));
let language = 'zh-CN';
export function t(value) {
 const key = reverse.get(value) || value;
 return language === 'en' ? (messages[key] || value) : key;
}
function translate(value) {
 const trimmed = value.trim();
 return trimmed ? value.replace(trimmed, t(trimmed)) : value;
}
export function setLanguage(next) {
 language = next === 'en' ? 'en' : 'zh-CN';
 document.documentElement.lang = language;
 const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
 while (walker.nextNode()) {
  const node = walker.currentNode;
  if (node.parentElement.closest('script,style,#language-toggle')) continue;
  node.nodeValue = translate(node.nodeValue);
 }
 document.querySelectorAll('[aria-label],[title]').forEach(element => {
  if (element.id === 'language-toggle') return;
  for (const attr of ['aria-label','title']) if (element.hasAttribute(attr)) element.setAttribute(attr, translate(element.getAttribute(attr)));
 });
 document.title = t(document.title);
 const description = document.querySelector('meta[name="description"]');
 description.content = t(description.content);
 const button = document.querySelector('#language-toggle');
 button.textContent = language === 'en' ? '中' : 'EN';
 button.setAttribute('aria-label', language === 'en' ? 'Switch to Chinese' : '切换为英文');
 button.title = language === 'en' ? 'Switch to Chinese' : '切换为英文';
 // Recalculate the animated navigation after its labels change size.
 window.dispatchEvent(new Event('resize'));
}
document.querySelector('#language-toggle').addEventListener('click', () => setLanguage(language === 'en' ? 'zh-CN' : 'en'));
