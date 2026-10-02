import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { caseDigest } from './helpers/production-cases.js';
import { wireEditor } from './helpers/editor-mcp.js';

const slice = path.resolve('vendor/godot-demo-slice');
const revision = '3e08537616661a5883831628decab4c526260289';
const scriptHash = '87f4fcf7481dba031f74a363475cee75b81c3d42eb1347b318f6b824e37329a6';
const licenseHash = '0339177149b474f7ff676d32218ecb3a8f2538955610023c3769763720d09e4c';
async function lockedSlice() {
  const script = await readFile(path.join(slice, 'player.gd'));
  const license = await readFile(path.join(slice, 'LICENSE.md'));
  const provenance = JSON.parse(await readFile(path.join(slice, 'provenance.json'), 'utf8'));
  assert.equal(provenance.revision, revision);
  assert.equal(provenance.license, 'MIT');
  assert.equal(script.length, 1330);
  assert.equal(license.length, 1134);
  assert.equal(caseDigest(script), scriptHash);
  assert.equal(caseDigest(license), licenseHash);
  return { script: script.toString('utf8'), license };
}
test('T29 external script and MIT notice are exact pinned upstream bytes, not a local rewrite', async () => {
  await lockedSlice();
});
test(
  'T29 X01 pinned external player script: wrong baseline rejects, exact candidate validates and persists',
  { skip: !existsSync(process.env.GODOT_PATH ?? ''), timeout: 90000 },
  async () => {
    const { script, license } = await lockedSlice();
    // Local, deliberately minimal dependency scene; not the upstream game or its assets.
    const scene =
      '[gd_scene load_steps=4 format=3]\n[ext_resource type="Script" path="res://player.gd" id="1"]\n[sub_resource type="SpriteFrames" id="Frames"]\n[sub_resource type="CircleShape2D" id="Shape"]\n[node name="Main" type="Node"]\n[node name="Player" type="Area2D" parent="."]\nscript = ExtResource("1")\n[node name="AnimatedSprite2D" type="AnimatedSprite2D" parent="Player"]\nsprite_frames = SubResource("Frames")\n[node name="Trail" type="Node2D" parent="Player"]\n[node name="CollisionShape2D" type="CollisionShape2D" parent="Player"]\nshape = SubResource("Shape")\n';
    const checks = [
      {
        id: 'external-speed',
        method: 'get_property',
        params: { nodePath: 'Player', property: 'speed' },
        path: 'value',
        op: 'equals',
        expected: 800,
      },
    ];
    const project =
      '[application]\nconfig/name="Pinned external script slice"\nrun/main_scene="res://main.tscn"\n[input]\n' +
      ['move_right', 'move_left', 'move_down', 'move_up']
        .map((name) => name + '={"deadzone":0.5,"events":[]}\n')
        .join('');
    const oracle = {
      revision,
      scriptHash,
      licenseHash,
      scene,
      project,
      checks,
      replacement: 'speed = 800',
      timeoutMs: 20000,
      scopes: ['read', 'write', 'run'],
      approval: 'MOCK',
    };
    const report = {
      caseId: 'X01',
      source: 'MIXED',
      engine: 'REAL',
      approval: 'MOCK',
      transport: 'official SDK InMemoryTransport',
      oracleHash: caseDigest(JSON.stringify(oracle)),
      sourceHash: process.env.WHEEL_CASE_SOURCE_HASH ?? 'NOT_BOUND',
      upstream: { revision, scriptHash, licenseHash },
      localDependencySceneHash: caseDigest(scene),
      status: 'FAIL',
      cleanup: false,
      calls: [] as unknown[],
      error: undefined as string | undefined,
    };
    const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-external-slice-'));
    await writeFile(path.join(root, 'project.godot'), project);
    await writeFile(path.join(root, 'main.tscn'), scene);
    await writeFile(path.join(root, 'player.gd'), script);
    await writeFile(path.join(root, 'LICENSE.md'), license);
    const c = await wireEditor(root);
    try {
      const call = async (name: string, args: Record<string, unknown>, expectedError = false) => {
        const reply = await c.call(name, args);
        report.calls.push({
          name,
          args,
          result: {
            isError: reply.isError ?? false,
            data: reply.structuredContent,
            sha256: caseDigest(JSON.stringify(reply)),
          },
        });
        if (expectedError) assert.equal(reply.isError, true);
        else assert.notEqual(reply.isError, true, JSON.stringify(reply.structuredContent));
        return reply.structuredContent as any;
      };
      const packet = await call('begin_client_repair', {
        projectPath: root,
        godotPath: process.env.GODOT_PATH,
        bridgePath: path.resolve('godot-plugin/runtime_bridge.gd'),
        evidenceDir: path.join(root, 'evidence'),
        allowedRepairFiles: ['player.gd'],
        checks,
        timeoutMs: 20000,
      });
      assert.equal(packet.status, 'NEEDS_REPAIR', JSON.stringify(packet));
      const proposal = {
        source: 'fixed upstream slice fixture',
        rationale: 'Change only exported speed; retain original validation',
        edits: [{ path: 'player.gd', find: 'speed = 400', replace: 'speed = 800', expectedSha256: '0'.repeat(64) }],
      };
      await call(
        'submit_repair_candidate',
        { repairId: packet.repairId, candidateId: randomUUID(), approved: true, proposal },
        true,
      );
      assert.equal(await readFile(path.join(root, 'player.gd'), 'utf8'), script);
      const unchanged = await call('get_client_repair_status', { repairId: packet.repairId });
      assert.equal(unchanged.remainingCandidates, 2);
      proposal.edits[0].expectedSha256 = scriptHash;
      const result = await call('submit_repair_candidate', {
        repairId: packet.repairId,
        candidateId: randomUUID(),
        approved: true,
        proposal,
      });
      assert.equal(result.status, 'PASS', JSON.stringify(result));
      assert.equal(result.persisted, true);
      assert.equal(result.cleanup, true);
      assert.equal(await readFile(path.join(root, 'player.gd'), 'utf8'), script.replace('speed = 400', 'speed = 800'));
      assert.equal(await readFile(path.join(root, 'main.tscn'), 'utf8'), scene);
      assert.equal(caseDigest(await readFile(path.join(root, 'LICENSE.md'))), licenseHash);
      report.status = 'PASS';
    } catch (error) {
      report.error = String(error).slice(0, 8192);
      throw error;
    } finally {
      try {
        await c.close();
        report.cleanup = true;
      } finally {
        const reports = process.env.WHEEL_CASE_REPORT_DIR ?? path.join(root, 'reports');
        await mkdir(reports, { recursive: true });
        await writeFile(path.join(reports, 'X01.json'), JSON.stringify(report, null, 2));
      }
    }
  },
);
