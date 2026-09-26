import { createHash } from 'node:crypto';

export const defectCatalog = [
  {
    id: 'D01',
    ownerTasks: ['T03'],
    title: 'Tagged Vector2 property writes',
    expected: 'set_property and create_node decode a tagged Vector2 and read back its exact coordinates',
  },
  {
    id: 'D02',
    ownerTasks: ['T02'],
    title: 'Missing runtime node error',
    expected: 'A missing node produces an MCP isError result with a stable machine-readable error code',
  },
  {
    id: 'D03',
    ownerTasks: ['T04'],
    title: 'Persistent event protocol',
    expected: 'Persistent runtime notifications are readable through get_runtime_events without invalid lines',
  },
  {
    id: 'D04',
    ownerTasks: ['T06'],
    title: 'Reloaded script freshness',
    expected: 'scene reload labels code freshness unverified; a new-process validation observes the edited script',
  },
  {
    id: 'D05',
    ownerTasks: ['T05'],
    title: 'Compact game-state preservation',
    expected: 'Compact mode retains requested business properties while reducing only redundant envelope fields',
  },
  {
    id: 'D06',
    ownerTasks: ['T07'],
    title: 'One-shot runtime state continuity',
    expected:
      'Legacy one-shot calls are explicitly isolated, while session-bound property, input, state and screenshot operations share one coherent runtime',
  },
  {
    id: 'D07',
    ownerTasks: ['T09', 'T14'],
    title: 'Invalid scene accepted as saved',
    expected: 'write_scene_file rejects a scene the real Godot parser cannot load',
  },
  {
    id: 'D08',
    ownerTasks: ['T09'],
    title: 'res:// path normalization',
    expected: 'read_scene_file accepts a contained res:// path and returns the same content as a relative path',
  },
  {
    id: 'D09',
    ownerTasks: ['T18', 'T22'],
    title: '3D capability and semantic analysis boundary',
    expected:
      '3D specialized queries explicitly report unsupported capability and semantic analysis resolves qualified enum transitions',
  },
  {
    id: 'D10',
    ownerTasks: ['T08'],
    title: 'HTTP run-scope method permission',
    expected: 'A run-only HTTP client cannot use call_runtime_bridge to mutate a runtime property',
  },
];

export function classifyProbe(probe) {
  if (probe?.verified !== true) return 'INVALID_REPRO';
  return probe.correct === true ? 'PASS' : 'EXPECTED_DEFECT';
}

export function validateBaselineSummary(summary) {
  const errors = [];
  const expectedIds = defectCatalog.map((item) => item.id);
  if (
    summary?.testDouble !== 'MIXED' ||
    summary?.provenance?.engine !== 'REAL' ||
    !summary?.provenance?.projectWriteApproval?.startsWith('MOCK:')
  )
    errors.push('real engine and MOCK project approval must be reported separately');
  const actualIds = summary?.cases?.map((item) => item.id) ?? [];
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) errors.push('D01–D10 coverage/order mismatch');
  if (
    summary?.controls?.some((item) => item.status !== 'PASS') ||
    ['C01', 'C02', 'C03'].some((id) => !summary?.controls?.some((item) => item.id === id && item.status === 'PASS'))
  )
    errors.push('all scalar/Vector2, diagnostics, and real-rendered screenshot controls must PASS');
  for (const item of summary?.cases ?? []) {
    const catalog = defectCatalog.find((candidate) => candidate.id === item.id);
    if (!catalog || JSON.stringify(item.ownerTasks) !== JSON.stringify(catalog.ownerTasks))
      errors.push(`${item.id}: owner mapping mismatch`);
    if (!['PASS', 'EXPECTED_DEFECT'].includes(item.status)) errors.push(`${item.id}: not a verified defect or PASS`);
    if (!item.expected || !item.actual || !item.input || !item.evidence)
      errors.push(`${item.id}: missing audit fields`);
    if (
      item.provenance?.execution !== 'REAL' ||
      item.provenance?.approval !== (['D04', 'D07'].includes(item.id) ? 'MOCK' : 'NOT_RUN')
    )
      errors.push(`${item.id}: execution/approval provenance mismatch`);
    if (!/^[a-f0-9]{64}$/.test(item.evidence?.actualSha256 ?? ''))
      errors.push(`${item.id}: actual evidence hash missing`);
    else if (createHash('sha256').update(JSON.stringify(item.actual)).digest('hex') !== item.evidence.actualSha256)
      errors.push(`${item.id}: actual evidence hash mismatch`);
    if (item.id === 'D09') {
      const parts = item.subchecks ?? [];
      if (
        parts.map((part) => part.id).join(',') !== 'D09-3D,D09-SEMANTICS' ||
        parts[0]?.ownerTask !== 'T18' ||
        parts[1]?.ownerTask !== 'T22' ||
        parts.some((part) => !['PASS', 'EXPECTED_DEFECT'].includes(part.status))
      )
        errors.push('D09: separate 3D and semantic subchecks required');
    }
  }
  return errors;
}
