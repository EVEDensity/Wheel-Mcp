import os from 'node:os';
import path from 'node:path';

export function isGodotExecutableName(name) {
  if (/^godot(?:[_-].*)?\.exe$/i.test(name)) return true;
  if (/^Godot(?:[_-][\w.-]+)?$/i.test(name) && !name.endsWith('.app')) return true;
  return false;
}

export function fixedGodotCandidates() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [
      '/Applications/Godot.app/Contents/MacOS/Godot',
      path.join(home, 'Applications/Godot.app/Contents/MacOS/Godot'),
      '/opt/homebrew/bin/godot',
      '/usr/local/bin/godot',
    ];
  }
  if (process.platform === 'linux') {
    return ['/usr/bin/godot', '/usr/local/bin/godot', path.join(home, '.local/bin/godot')];
  }
  return [];
}

export function defaultSearchRoots() {
  const home = os.homedir();
  const roots = [path.join(home, 'Downloads'), path.join(home, 'Desktop')];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    roots.unshift(
      path.join(localAppData, 'Programs', 'Godot'),
      path.join(localAppData, 'Programs', 'Godot Engine'),
      path.join(programFiles, 'Godot'),
      path.join(programFiles, 'Godot Engine'),
      path.join(programFilesX86, 'Godot'),
      path.join(home, 'scoop', 'apps', 'godot', 'current'),
      'C:\\tools',
      'D:\\tools',
    );
  } else if (process.platform === 'darwin') {
    roots.unshift('/Applications', path.join(home, 'Applications'));
  } else {
    roots.unshift('/opt/godot', '/usr/local/godot', path.join(home, '.local/share/godot'));
  }
  return roots.filter(Boolean);
}

export function claudeDesktopConfigPath() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
}

export function windsurfConfigPath() {
  return path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
}

export function cursorGlobalConfigPath() {
  return path.join(os.homedir(), '.cursor', 'mcp.json');
}
