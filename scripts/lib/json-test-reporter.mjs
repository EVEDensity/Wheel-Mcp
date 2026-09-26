// Node's test runner supplies structured events to a custom reporter.
export default async function* jsonTestReporter(source) {
  let sawSummary = false;
  const counts = { tests: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0 };
  for await (const event of source) {
    if (['test:pass', 'test:fail', 'test:summary'].includes(event.type)) {
      const data = event.data;
      if (event.type === 'test:summary') sawSummary = true;
      else if (data.type !== 'suite') {
        counts.tests++;
        if (event.type === 'test:fail') counts.failed++;
        else if (data.skip) counts.skipped++;
        else if (data.todo) counts.todo++;
        else counts.passed++;
      }
      yield JSON.stringify({
        type: event.type,
        data:
          event.type === 'test:summary'
            ? data
            : {
                name: data.name,
                nesting: data.nesting,
                skip: data.skip ?? false,
                todo: data.todo ?? false,
                type: data.type ?? 'test',
                file: data.file,
                ...(event.type === 'test:fail'
                  ? {
                      error: {
                        message: String(data.details?.error?.message ?? '').slice(0, 2000),
                        stack: String(data.details?.error?.stack ?? '').slice(0, 4000),
                      },
                    }
                  : {}),
              },
      }) + '\n';
    }
  }
  // Node 20's test event stream has no cumulative test:summary. Keep the
  // fallback structured and fail closed if the stream was empty or truncated.
  if (!sawSummary) yield JSON.stringify({ type: 'test:summary', data: { counts, synthetic: true } }) + '\n';
}
