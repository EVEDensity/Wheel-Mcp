export function summarizeTestEvents(jsonLines) {
  let events;
  try {
    events = jsonLines
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error('test report is not valid JSON Lines');
  }
  // Node emits per-file summaries before its cumulative summary. A truncated
  // stream must not use one successful file as the whole-suite result.
  const summaries = events.filter((event) => event.type === 'test:summary' && event.data?.file === undefined);
  if (summaries.length === 0) throw new Error('test report has no final summary');
  const final = summaries.at(-1).data?.counts;
  if (
    !final ||
    !['tests', 'passed', 'failed', 'skipped', 'cancelled', 'todo'].every(
      (key) => Number.isSafeInteger(final[key]) && final[key] >= 0,
    )
  ) {
    throw new Error('test report final summary has missing or invalid counts');
  }
  if (final.tests === 0 || final.tests !== final.passed + final.failed + final.skipped + final.cancelled + final.todo) {
    throw new Error('test report counts are inconsistent or empty');
  }
  if (final.failed === 0 && events.some((event) => event.type === 'test:fail' && !event.data?.skip && !event.data?.todo)) {
    throw new Error('test report summary conceals a failure event');
  }
  const cases = events
    .filter((event) => event.type === 'test:pass' || event.type === 'test:fail')
    .map((event) => ({
      name: event.data?.name,
      status: event.type === 'test:fail' ? 'FAIL' : event.data?.skip ? 'SKIP' : event.data?.todo ? 'NOT_RUN' : 'PASS',
    }));
  if (cases.some((item) => typeof item.name !== 'string' || !item.name)) throw new Error('test event lacks case name');
  return { ...final, cases };
}
