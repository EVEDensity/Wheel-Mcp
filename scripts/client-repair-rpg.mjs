/** A disclosed, assistant-reviewed project ownership fix, NOT a held-out/model benchmark. */
import path from 'node:path';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const prior = JSON.parse(await readFile('benchmarks/repair-results-2026-09-13.json', 'utf8'));
const transcript = JSON.parse(await readFile(path.join(prior.output, 'mcp-transcript.json'), 'utf8'));
const original = transcript.find(
  (t) => t.name === 'dev_loop' && t.args.projectPath === path.join(prior.output, 'rpg', 'healthy'),
);
if (!original) throw Error('original RPG validation plan missing');
const output = path.resolve('runs/client-repair-rpg', new Date().toISOString().replaceAll(':', '-'));
const projectPath = path.join(output, 'project');
await mkdir(output, { recursive: true });
await cp(path.join(prior.output, 'rpg', 'repaired'), projectPath, {
  recursive: true,
  filter: (p) => !['.harness', '.git'].includes(path.basename(p)),
});
const client = new Client({ name: 'assistant-reviewed-project-repair', version: '1' });
const wire = [];
const call = async (name, args) => {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 45000 });
  wire.push({ name, args, response });
  await writeFile(path.join(output, 'mcp-transcript.json'), JSON.stringify(wire, null, 2));
  if (response.isError) throw Error(JSON.stringify(response));
  return response.structuredContent || JSON.parse(response.content[0].text);
};
const args = {
  ...original.args,
  projectPath,
  godotPath: process.env.GODOT_PATH,
  bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
  evidenceDir: path.join(output, 'evidence'),
  timeoutMs: 25000,
};
for (const key of [
  'edits',
  'repairs',
  'maxRetries',
  'rollbackOnFailure',
  'diagnosticsScope',
  'maxErrors',
  'responseMode',
])
  delete args[key];
const report = {
  output,
  projectPath,
  provenance:
    'Assistant reviewed detached screen ownership using actual shutdown logs; no live provider call; outside frozen historical corpus.',
};
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.resolve('build/src/mcp-server-sdk.js')],
      stderr: 'pipe',
    }),
  );
  report.begin = await call('begin_client_repair', { ...args, allowedRepairFiles: ['game.gd'], maxCandidates: 1 });
  if (report.begin.status !== 'NEEDS_REPAIR') throw Error('expected strict shutdown failure');
  const f = report.begin.files[0];
  const addition =
    '\n\n# remove_child transfers lifetime responsibility to this scene.\nfunc _exit_tree() -> void:\n\tfor screen in [combat_screen, exploration_screen]:\n\t\tif is_instance_valid(screen) and screen.get_parent() == null:\n\t\t\tscreen.free()\n';
  report.candidate = await call('submit_repair_candidate', {
    repairId: report.begin.repairId,
    approved: true,
    proposal: {
      source: 'assistant-reviewed-project-ownership-fix',
      rationale:
        'Release only the two scene-owned detached subtrees on exit; retain strict assertions and full shutdown diagnostics.',
      edits: [{ path: f.path, find: f.content, replace: f.content + addition, expectedSha256: f.sha256 }],
    },
  });
  report.reverified = await call('dev_loop', {
    ...args,
    evidenceDir: path.join(output, 'independent-reverify'),
    maxRetries: 0,
  });
  report.sourceSha256 = createHash('sha256')
    .update(await readFile(path.join(projectPath, 'game.gd')))
    .digest('hex');
  report.status = report.candidate.status === 'PASS' && report.reverified.status === 'PASS' ? 'PASS' : 'FAIL';
} catch (e) {
  report.status = 'ERROR';
  report.error = String(e);
} finally {
  await client.close();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(
  JSON.stringify(
    {
      status: report.status,
      output,
      projectPath,
      before: report.begin?.failure?.errorCount,
      after: report.candidate?.errorCount,
      error: report.error,
    },
    null,
    2,
  ),
);
if (report.status !== 'PASS') process.exitCode = 1;
