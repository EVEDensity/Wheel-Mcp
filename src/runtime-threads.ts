// Node's libuv thread pool defaults to 4 threads. ProjectIndex statistics and
// other filesystem-heavy tools queue on that pool, so a default-sized pool
// serializes large-directory scans and starves concurrent requests. The pool
// size is read exactly once, at the first asynchronous filesystem operation,
// and the run-registry singleton performs one during import evaluation; this
// module must therefore be the FIRST import of every process entrypoint so
// the default applies before the pool is created. An explicit user value
// (UV_THREADPOOL_SIZE already set) always wins.
process.env.UV_THREADPOOL_SIZE ||= '16';
