/** Only the test registry is forwarded through the SDK's minimal environment.
 * Never pass all process.env (which may contain user credentials) to fixtures.
 */
export function fixtureStdioEnv(extra: Record<string, string> = {}): Record<string, string> {
  const registry = process.env.GODOT_HARNESS_RUN_REGISTRY_PATH;
  return { ...(registry ? { GODOT_HARNESS_RUN_REGISTRY_PATH: registry } : {}), ...extra };
}
