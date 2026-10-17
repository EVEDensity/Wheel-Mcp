/** Do not turn a package consumer into the parent project's npm lifecycle. */
export function consumerNpmEnvironment(input) {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([key]) =>
        !/^(?:npm_package_|npm_lifecycle_|npm_command$|npm_execpath$|npm_node_execpath$|npm_config_local_prefix$|INIT_CWD$)/i.test(
          key,
        ),
    ),
  );
}

/** Keep actionable errors rather than hundreds of cache-hit lines. */
export function npmFailureDetails(text) {
  const useful = text
    .split(/\r?\n/)
    .filter((line) => !/^npm http cache .*\(cache hit\)/.test(line))
    .join('\n');
  const redacted = useful.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@');
  return redacted.length <= 2600
    ? redacted
    : `${redacted.slice(0, 700)}\n[bounded diagnostics]\n${redacted.slice(-1800)}`;
}
