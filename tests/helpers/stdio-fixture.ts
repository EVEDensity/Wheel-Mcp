/** Only the test registry, selected engine and scratch paths are forwarded.
 * Never pass all process.env (which may contain user credentials) to fixtures.
 */
export function fixtureStdioEnv(extra: Record<string, string> = {}): Record<string, string> {
  const allowed = ['GODOT_HARNESS_RUN_REGISTRY_PATH', 'GODOT_PATH', 'TEMP', 'TMP', 'TMPDIR'];
  return {
    ...Object.fromEntries(allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]!])),
    ...extra,
  };
}
