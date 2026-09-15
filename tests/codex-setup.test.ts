import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'smol-toml';

const load = (name: string) => import(pathToFileURL(path.join(process.cwd(), 'scripts/lib', name)).href);

test('global host list actually registers Codex and honors CODEX_HOME', async () => {
  const { listMcpHosts } = await load('mcp-hosts.mjs');
  const host = listMcpHosts(process.cwd(), { includeGlobal: true }).find((h: { id: string }) => h.id === 'codex');
  assert.ok(host);
  assert.equal(host.format, 'toml');
  assert.equal(host.autoConfigure, true);
  assert.equal(host.entry.args[0], path.join(process.cwd(), 'scripts/run-mcp.mjs'));
  assert.equal(
    listMcpHosts(process.cwd()).some((h: { id: string }) => h.id === 'codex'),
    false,
  );
});

test('Codex merge is repeatable, preserves other settings and backs up original', async () => {
  const { mergeCodexConfig } = await load('codex-config.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wheel-codex-'));
  const file = path.join(dir, 'config.toml');
  const original =
    '# original comment\nmodel = "test"\n[mcp_servers.other]\ncommand = "other"\n[mcp_servers."wheel-mcp"]\ncommand = "old"\n[mcp_servers."wheel-mcp".env]\nKEEP = "yes"\n';
  await writeFile(file, original);
  for (let i = 0; i < 2; i++) await mergeCodexConfig(file, process.cwd(), 'C:/Godot.exe', true);
  const result = parse(await readFile(file, 'utf8')) as any;
  assert.equal(result.model, 'test');
  assert.equal(result.mcp_servers.other.command, 'other');
  assert.equal(result.mcp_servers['wheel-mcp'].env.KEEP, 'yes');
  assert.equal(result.mcp_servers['wheel-mcp'].env.GODOT_PATH, 'C:/Godot.exe');
  const backups = (await readdir(dir)).filter((f) => f.endsWith('.bak'));
  assert.ok(backups.length);
  assert.equal(await readFile(path.join(dir, backups[0]), 'utf8'), original);
  assert.equal(await mergeCodexConfig(file, process.cwd(), undefined, false), false);
  await writeFile(file, '[broken');
  await assert.rejects(mergeCodexConfig(file, process.cwd(), undefined, true));
  assert.equal(await readFile(file, 'utf8'), '[broken');
});
