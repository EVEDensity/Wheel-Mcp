import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { wireEditor, productionCaseTransportLabel } from './editor-mcp.js';
import { caseDigest } from './production-cases.js';

const mainScript = 'extends Node\nvar health = 0\nvar limit = preload("res://config.gd").LIMIT\n';
const configScript = 'extends RefCounted\nconst LIMIT = 0\n';
const scene =
  '[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="Main" type="Node"]\nscript = ExtResource("1")\n';
const project = '[application]\nconfig/name="Client repair"\nrun/main_scene="res://main.tscn"\n';
const checks = ['health', 'limit'].map((property) => ({
  id: property,
  method: 'get_property' as const,
  params: { nodePath: '.', property },
  path: 'value',
  op: 'equals' as const,
  expected: 100,
}));
const repairStepSchema = z
  .object({
    tool: z.string().min(1).optional(),
    action: z.enum(['armDeliveryFailure', 'assertFiles']).optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    bind: z.string().min(1).optional(),
    bindFrom: z.string().min(1).optional(),
    expectCode: z.string().min(1).optional(),
    expectMatch: z.string().min(1).optional(),
    expectStatus: z.string().min(1).optional(),
    equals: z
      .object({ path: z.string().min(1), value: z.unknown() })
      .strict()
      .optional(),
    files: z.enum(['original', 'repaired']).optional(),
  })
  .strict()
  .refine((step) => Boolean(step.tool) !== Boolean(step.action), 'A repair step needs one tool or action');
export const repairProductionCaseSchema = z
  .object({
    id: z.string().regex(/^S0[1-6]$/),
    family: z.literal('scripts'),
    approval: z.enum(['accept', 'decline']),
    maxCandidates: z.number().int().min(1).max(3),
    steps: z.array(repairStepSchema).min(1),
  })
  .strict();
export type RepairProductionCase = z.infer<typeof repairProductionCaseSchema>;
const candidate = (id: string, to: string, sha?: string) => ({
  repairId: { bind: 'packet', field: 'repairId' },
  candidateId: id,
  approved: true,
  proposal: {
    source: 'fixed-candidate',
    rationale: 'bounded exact script replacement',
    edits: { repairEdits: { replaceFrom: '= 0', replaceTo: to, ...(sha ? { sha } : {}) } },
  },
});
const begin = {
  tool: 'begin_client_repair',
  args: { allowedRepairFiles: ['main.gd', 'config.gd'], maxCandidates: 2, timeoutMs: 60000, checks },
  bind: 'packet',
};
const repairDefinitions = [
  {
    id: 'S01',
    family: 'scripts',
    approval: 'accept',
    maxCandidates: 2,
    steps: [
      begin,
      {
        tool: 'submit_repair_candidate',
        args: candidate('11111111-1111-4111-8111-111111111111', '= 100', '0'.repeat(64)),
        expectMatch: 'hash mismatch',
        files: 'original',
      },
      {
        tool: 'get_client_repair_status',
        args: { repairId: { bind: 'packet', field: 'repairId' } },
        equals: { path: 'remainingCandidates', value: 2 },
      },
      {
        tool: 'submit_repair_candidate',
        args: candidate('22222222-2222-4222-8222-222222222222', '= 100'),
        expectStatus: 'PASS',
        files: 'repaired',
      },
    ],
  },
  {
    id: 'S02',
    family: 'scripts',
    approval: 'accept',
    maxCandidates: 2,
    steps: [
      begin,
      {
        tool: 'submit_repair_candidate',
        args: candidate('33333333-3333-4333-8333-333333333333', '= 1'),
        expectStatus: 'FAIL',
        files: 'original',
      },
      {
        tool: 'submit_repair_candidate',
        args: candidate('44444444-4444-4444-8444-444444444444', '= 100'),
        expectStatus: 'PASS',
        files: 'repaired',
      },
    ],
  },
  {
    id: 'S03',
    family: 'scripts',
    approval: 'decline',
    maxCandidates: 2,
    steps: [
      begin,
      {
        tool: 'submit_repair_candidate',
        args: candidate('55555555-5555-4555-8555-555555555555', '= 100'),
        expectCode: 'FORBIDDEN',
        files: 'original',
      },
    ],
  },
  {
    id: 'S04',
    family: 'scripts',
    approval: 'accept',
    maxCandidates: 2,
    steps: [
      begin,
      {
        tool: 'submit_repair_candidate',
        args: candidate('66666666-6666-4666-8666-666666666666', '= 1'),
        expectStatus: 'FAIL',
        files: 'original',
      },
      {
        tool: 'submit_repair_candidate',
        args: candidate('66666666-6666-4666-8666-666666666666', '= 1'),
        expectCode: 'CONFLICT',
        files: 'original',
      },
      {
        tool: 'submit_repair_candidate',
        args: candidate('77777777-7777-4777-8777-777777777777', '= 1'),
        expectCode: 'CONFLICT',
        files: 'original',
      },
      {
        tool: 'get_client_repair_status',
        args: {
          repairId: { bind: 'packet', field: 'repairId' },
          candidateId: '66666666-6666-4666-8666-666666666666',
        },
        equals: { path: 'remainingCandidates', value: 1 },
      },
    ],
  },
  {
    id: 'S06',
    family: 'scripts',
    approval: 'accept',
    maxCandidates: 2,
    steps: [
      begin,
      { action: 'armDeliveryFailure' },
      {
        tool: 'submit_repair_candidate',
        args: candidate('88888888-8888-4888-8888-888888888888', '= 100'),
        expectMatch: 'verification.json',
        files: 'repaired',
      },
      {
        tool: 'get_client_repair_status',
        args: {
          repairId: { bind: 'packet', field: 'repairId' },
          candidateId: '88888888-8888-4888-8888-888888888888',
        },
        equals: { path: 'candidates.0.deliveryFailed', value: true },
      },
      {
        tool: 'submit_repair_candidate',
        args: candidate('88888888-8888-4888-8888-888888888888', '= 100'),
        expectMatch: 'already submitted',
      },
    ],
  },
];
export function repairProductionCases(): RepairProductionCase[] {
  return repairDefinitions.map((definition) => repairProductionCaseSchema.parse(structuredClone(definition)));
}

function readPath(value: unknown, dotted: string) {
  return dotted.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}
function materialize(value: unknown, binds: Map<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => materialize(item, binds));
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') === 'bind,field' && typeof record.bind === 'string' && typeof record.field === 'string') {
    const source = binds.get(record.bind) as Record<string, unknown>;
    return structuredClone(readPath(source, record.field));
  }
  if (keys.length === 1 && keys[0] === 'repairEdits') {
    const spec = record.repairEdits as { replaceFrom: string; replaceTo: string; sha?: string };
    const packet = binds.get('packet') as { files: Array<{ path: string; content: string; sha256: string }> };
    return packet.files.map((file) => ({
      path: file.path,
      find: file.content,
      replace: file.content.split(spec.replaceFrom).join(spec.replaceTo),
      expectedSha256: spec.sha ?? file.sha256,
    }));
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, materialize(item, binds)]));
}

/** Fixed repair MCP calls. Host confirmation is an explicit MOCK; delivery blocking is a labeled fixture fault. */
export async function runRepairProductionCase(definition: RepairProductionCase) {
  const frozen = repairProductionCaseSchema.parse(structuredClone(definition));
  const root = await mkdtemp(path.join(os.tmpdir(), 'wheel-repair-case-'));
  await writeFile(path.join(root, 'project.godot'), project);
  await writeFile(path.join(root, 'main.tscn'), scene);
  await writeFile(path.join(root, 'main.gd'), mainScript);
  await writeFile(path.join(root, 'config.gd'), configScript);
  const evidenceDir = path.join(root, 'evidence');
  await mkdir(evidenceDir, { recursive: true });
  let deliveryDir = '';
  const connection = await wireEditor(root, {
    scopes: ['read', 'write', 'run'],
    approval: async () => {
      if (deliveryDir) await mkdir(path.join(deliveryDir, 'candidate-1', 'verification.json'), { recursive: true });
      return frozen.approval === 'accept'
        ? { action: 'accept' as const, content: { confirm: true } }
        : { action: 'decline' as const };
    },
  });
  const binds = new Map<string, unknown>();
  const report = {
    caseId: frozen.id,
    family: 'scripts',
    source: 'REAL',
    approval: 'MOCK',
    transport: productionCaseTransportLabel(),
    oracleHash: caseDigest(JSON.stringify({ frozen, scripts: { mainScript, configScript, scene, project, checks } })),
    sourceHash: process.env.WHEEL_CASE_SOURCE_HASH ?? 'NOT_BOUND',
    status: 'FAIL',
    checks: [] as string[],
    error: undefined as string | undefined,
  };
  const reportRoot = process.env.WHEEL_CASE_REPORT_DIR ?? path.join(os.tmpdir(), 'wheel-case-reports');
  let failure: unknown;
  try {
    for (const step of frozen.steps) {
      if (step.action === 'armDeliveryFailure') {
        deliveryDir = String(readPath(binds.get('packet'), 'evidenceDir'));
        assert.ok(deliveryDir.startsWith(root), deliveryDir);
        report.checks.push('delivery failure is an explicit fixture fault, not a product client');
        continue;
      }
      if (step.action === 'assertFiles') {
        await assertFiles(root, step.files ?? 'original');
        continue;
      }
      const args = materialize(step.args ?? {}, binds) as Record<string, unknown>;
      if (step.tool === 'begin_client_repair') {
        args.godotPath = process.env.GODOT_PATH;
        args.bridgePath = path.resolve('godot-plugin/runtime_bridge.gd');
        args.evidenceDir = evidenceDir;
      }
      const reply = await connection.call(step.tool!, args);
      const body = (reply.structuredContent ?? {}) as Record<string, any>;
      if (step.expectMatch) {
        assert.equal(reply.isError, true, JSON.stringify(reply).slice(0, 2000));
        assert.match(JSON.stringify(reply), new RegExp(step.expectMatch), JSON.stringify(reply).slice(0, 2000));
      } else if (step.expectCode) {
        assert.equal(reply.isError, true, JSON.stringify(reply).slice(0, 2000));
        assert.equal(body.code, step.expectCode, JSON.stringify(body).slice(0, 2000));
      } else if (step.expectStatus) {
        assert.equal(body.status, step.expectStatus, JSON.stringify(body).slice(0, 2000));
      } else assert.notEqual(reply.isError, true, JSON.stringify(reply).slice(0, 2000));
      if (step.bind) binds.set(step.bind, step.bindFrom ? readPath(body, step.bindFrom) : body);
      if (step.equals)
        assert.deepEqual(readPath(body, step.equals.path), step.equals.value, JSON.stringify(body).slice(0, 2000));
      if (step.files) await assertFiles(root, step.files);
    }
    report.checks.push('fixed repair calls matched the frozen oracle');
    report.status = 'PASS';
  } catch (error) {
    report.error = error instanceof Error ? error.message.slice(0, 8192) : String(error);
    failure = error;
  } finally {
    await connection.close().catch(() => undefined);
    await mkdir(reportRoot, { recursive: true });
    await writeFile(path.join(reportRoot, frozen.id + '.json'), JSON.stringify(report, null, 2));
  }
  if (failure) throw failure;
}

async function assertFiles(root: string, mode: 'original' | 'repaired') {
  const main = await readFile(path.join(root, 'main.gd'), 'utf8');
  const config = await readFile(path.join(root, 'config.gd'), 'utf8');
  if (mode === 'original') {
    assert.equal(main, mainScript);
    assert.equal(config, configScript);
  } else {
    assert.equal(main, mainScript.split('= 0').join('= 100'));
    assert.equal(config, configScript.split('= 0').join('= 100'));
  }
}
