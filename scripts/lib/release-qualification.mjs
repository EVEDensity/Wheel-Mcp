/** Current-source qualification, separate from a successful historical runtime matrix. */
export function assessReleaseQualification(state, sourceHash) {
  const errors = [];
  if (!/^[a-f0-9]{64}$/.test(sourceHash ?? '')) errors.push('invalid candidate source identity');
  if (!Array.isArray(state.tasks) || state.tasks.length !== 36) errors.push('complete 36-task roadmap is required');
  for (let i = 0; i < 36; i++) {
    const id = 'T' + String(i).padStart(2, '0');
    const task = state.tasks?.find((t) => t.id === id);
    if (task?.status !== 'done') errors.push(`${id} is ${task?.status ?? 'missing'}, not done`);
    if (!task?.verification?.length || task.verification.some((v) => v.required && v.status !== 'PASS'))
      errors.push(`${id} required acceptance is incomplete`);
  }
  for (let i = 0; i < 7; i++) {
    const id = `G${i}`;
    const gate = state.gates?.find((g) => g.id === id);
    if (gate?.status !== 'PASS') errors.push(`${id} is ${gate?.status ?? 'missing'}, not PASS`);
    if (gate?.sourceHash !== sourceHash)
      errors.push(`${id} is not qualified for the current sourceHash; historical PASS cannot be reused`);
  }
  if (state.qualification?.status !== 'QUALIFIED')
    errors.push(`production qualification is ${state.qualification?.status ?? 'missing'}`);
  if (state.qualification?.candidateSourceHash !== sourceHash)
    errors.push('qualification candidateSourceHash differs from current source');
  return errors;
}
