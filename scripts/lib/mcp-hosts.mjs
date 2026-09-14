import path from 'node:path';
import { claudeDesktopConfigPath, cursorGlobalConfigPath, windsurfConfigPath } from './platform-paths.mjs';

export const SERVER_NAME = 'wheel-mcp';

export function workspaceLaunchEntry() {
  return {
    command: 'node',
    args: ['${workspaceFolder}/scripts/run-mcp.mjs'],
  };
}

export function vscodeLaunchEntry() {
  return {
    type: 'stdio',
    command: 'node',
    args: ['${workspaceFolder}/scripts/run-mcp.mjs'],
  };
}

export function absoluteLaunchEntry(projectRoot) {
  return {
    command: process.execPath,
    args: [path.join(projectRoot, 'scripts', 'run-mcp.mjs')],
  };
}

export function listMcpHosts(projectRoot, options = {}) {
  const { includeGlobal = false } = options;
  const projectHosts = [
    {
      id: 'cursor',
      label: 'Cursor',
      scope: 'project',
      filePath: path.join(projectRoot, '.cursor', 'mcp.json'),
      rootKey: 'mcpServers',
      entry: workspaceLaunchEntry(),
      autoConfigure: true,
    },
    {
      id: 'vscode',
      label: 'VS Code / GitHub Copilot',
      scope: 'project',
      filePath: path.join(projectRoot, '.vscode', 'mcp.json'),
      rootKey: 'servers',
      entry: vscodeLaunchEntry(),
      autoConfigure: true,
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      scope: 'project',
      filePath: path.join(projectRoot, '.mcp.json'),
      rootKey: 'mcpServers',
      entry: workspaceLaunchEntry(),
      autoConfigure: true,
    },
  ];

  if (!includeGlobal) return projectHosts;

  const absoluteEntry = absoluteLaunchEntry(projectRoot);
  return [
    ...projectHosts,
    {
      id: 'cursor-global',
      label: 'Cursor (global)',
      scope: 'global',
      filePath: cursorGlobalConfigPath(),
      rootKey: 'mcpServers',
      entry: absoluteEntry,
      autoConfigure: true,
      note: 'Uses absolute paths so Cursor can start Wheel-mcp outside this workspace.',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      scope: 'global',
      filePath: claudeDesktopConfigPath(),
      rootKey: 'mcpServers',
      entry: absoluteEntry,
      autoConfigure: true,
      note: 'Restart Claude Desktop after setup.',
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      scope: 'global',
      filePath: windsurfConfigPath(),
      rootKey: 'mcpServers',
      entry: absoluteEntry,
      autoConfigure: true,
      note: 'Restart Windsurf after setup.',
    },
  ];
}
