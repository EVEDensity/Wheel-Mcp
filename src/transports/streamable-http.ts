import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClientPolicy, type McpClientPolicy, type McpPermission } from '../mcp/access-policy.js';
import { HttpAuditLogger, requestAuditFields } from './http-audit.js';
import { HttpConcurrencyLimiter, HttpRateLimiter } from './http-limits.js';
import { HttpRequestRegistry, runWithHttpRequestContext } from './http-lifecycle.js';
import { HttpTokenProvider, type RotatingHttpClientConfig } from './http-token-provider.js';

export type HttpClientConfig = {
  token: string;
  clientId: string;
  scopes: McpPermission[];
  projectRoots: string[];
  evidenceRoots: string[];
  expiresAt?: string;
};

export type StreamableHttpConfig = {
  host: string;
  port: number;
  path: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  requestTimeoutMs: number;
  clients: HttpClientConfig[];
  tokenFile?: string;
  tokenReloadIntervalMs?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  rateLimitMaxRequestsPerClient?: number;
  maxConcurrentRequests?: number;
  maxConcurrentRequestsPerClient?: number;
  shutdownTimeoutMs?: number;
  auditLog?: string;
};

type Session = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  policy: McpClientPolicy;
};

type HttpServerInstance = {
  httpServer: Server;
  close: () => Promise<void>;
};

export function readStreamableHttpConfig(env = process.env): StreamableHttpConfig {
  const host = env.MCP_HTTP_HOST ?? '127.0.0.1';
  const allowRemote = env.MCP_HTTP_ALLOW_REMOTE === 'true';
  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error('MCP_HTTP_HOST must be localhost/loopback unless MCP_HTTP_ALLOW_REMOTE=true');
  }
  const port = integerEnv(env.MCP_HTTP_PORT, 3000, 'MCP_HTTP_PORT');
  const requestTimeoutMs = integerEnv(env.MCP_HTTP_REQUEST_TIMEOUT_MS, 30_000, 'MCP_HTTP_REQUEST_TIMEOUT_MS');
  const path = env.MCP_HTTP_PATH ?? '/mcp';
  if (!path.startsWith('/')) throw new Error('MCP_HTTP_PATH must begin with /');
  const clients = parseClients(env);
  const tokenFile = env.MCP_HTTP_AUTH_TOKENS_FILE;
  if (clients.length === 0 && !tokenFile) {
    throw new Error('MCP HTTP requires MCP_HTTP_AUTH_TOKENS, MCP_HTTP_BEARER_TOKEN, or MCP_HTTP_AUTH_TOKENS_FILE');
  }
  const allowedOrigins = splitList(env.MCP_HTTP_ALLOWED_ORIGINS ?? `http://${host}:${port}`);
  const allowedHosts = splitList(env.MCP_HTTP_ALLOWED_HOSTS ?? `${host}:${port}`);
  if (allowedOrigins.length === 0 || allowedHosts.length === 0) {
    throw new Error('MCP HTTP requires non-empty allowed origins and hosts');
  }
  return {
    host,
    port,
    path,
    allowedOrigins,
    allowedHosts,
    requestTimeoutMs,
    clients,
    tokenFile,
    tokenReloadIntervalMs: integerEnv(
      env.MCP_HTTP_TOKEN_RELOAD_INTERVAL_MS,
      0,
      'MCP_HTTP_TOKEN_RELOAD_INTERVAL_MS',
      true,
    ),
    rateLimitWindowMs: integerEnv(env.MCP_HTTP_RATE_LIMIT_WINDOW_MS, 60_000, 'MCP_HTTP_RATE_LIMIT_WINDOW_MS'),
    rateLimitMaxRequests: integerEnv(env.MCP_HTTP_RATE_LIMIT_MAX_REQUESTS, 1_000, 'MCP_HTTP_RATE_LIMIT_MAX_REQUESTS'),
    rateLimitMaxRequestsPerClient: integerEnv(
      env.MCP_HTTP_RATE_LIMIT_MAX_REQUESTS_PER_CLIENT,
      1_000,
      'MCP_HTTP_RATE_LIMIT_MAX_REQUESTS_PER_CLIENT',
    ),
    maxConcurrentRequests: integerEnv(env.MCP_HTTP_MAX_CONCURRENT_REQUESTS, 100, 'MCP_HTTP_MAX_CONCURRENT_REQUESTS'),
    maxConcurrentRequestsPerClient: integerEnv(
      env.MCP_HTTP_MAX_CONCURRENT_REQUESTS_PER_CLIENT,
      20,
      'MCP_HTTP_MAX_CONCURRENT_REQUESTS_PER_CLIENT',
    ),
    shutdownTimeoutMs: integerEnv(env.MCP_HTTP_SHUTDOWN_TIMEOUT_MS, 10_000, 'MCP_HTTP_SHUTDOWN_TIMEOUT_MS'),
    auditLog: env.MCP_HTTP_AUDIT_LOG,
  };
}

export async function startStreamableHttpServer(
  config: StreamableHttpConfig,
  createMcpServer: (policy: McpClientPolicy) => McpServer,
): Promise<HttpServerInstance> {
  const sessions = new Map<string, Session>();
  const tokenProvider = HttpTokenProvider.fromFile(config.clients, config.tokenFile, config.tokenReloadIntervalMs ?? 0);
  if (config.tokenFile) await tokenProvider.reload();
  const requestRegistry = new HttpRequestRegistry();
  const rateLimiter = new HttpRateLimiter(config.rateLimitWindowMs ?? 60_000, config.rateLimitMaxRequests ?? 1_000);
  const clientRateLimiter = new HttpRateLimiter(
    config.rateLimitWindowMs ?? 60_000,
    config.rateLimitMaxRequestsPerClient ?? 1_000,
  );
  const concurrencyLimiter = new HttpConcurrencyLimiter(
    config.maxConcurrentRequests ?? 100,
    config.maxConcurrentRequestsPerClient ?? 20,
  );
  const audit = new HttpAuditLogger(config.auditLog);
  let shuttingDown = false;
  let closePromise: Promise<void> | undefined;

  const httpServer = createServer(async (req, res) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const fields = requestAuditFields(req);
    let client: RotatingHttpClientConfig | undefined;
    let lifecycle: ReturnType<HttpRequestRegistry['begin']> | undefined;
    let sessionId: string | undefined;
    const finishAudit = (event: string, status: number, outcome: string, reason?: string) =>
      audit.request({
        ...fields,
        event,
        requestId,
        clientId: client?.clientId,
        mcpSessionId: sessionId,
        status,
        outcome,
        reason,
        durationMs: Date.now() - startedAt,
      });

    try {
      if (shuttingDown) {
        sendJson(res, 503, { error: 'server is shutting down' });
        finishAudit('request_rejected', 503, 'shutdown');
        return;
      }
      if (!req.url || new URL(req.url, `http://${req.headers.host ?? config.host}`).pathname !== config.path) {
        sendJson(res, 404, { error: 'not found' });
        finishAudit('request_rejected', 404, 'not_found');
        return;
      }
      client = authenticate(req, tokenProvider.getClients());
      if (!client) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        sendJson(res, 401, { error: 'unauthorized' });
        finishAudit('auth_failure', 401, 'unauthorized');
        return;
      }
      const headerError = validateSecurityHeaders(req, config);
      if (headerError) {
        sendJson(res, 403, { error: headerError });
        finishAudit('security_rejection', 403, 'invalid_security_headers', headerError);
        return;
      }
      const ipKey = req.socket.remoteAddress ?? 'unknown';
      const ipLimit = rateLimiter.check(ipKey);
      const clientLimit = clientRateLimiter.check(client.clientId);
      if (!ipLimit.allowed || !clientLimit.allowed) {
        const retryAfter = Math.max(
          !ipLimit.allowed ? ipLimit.retryAfterSeconds : 0,
          !clientLimit.allowed ? clientLimit.retryAfterSeconds : 0,
        );
        sendJson(res, 429, { error: 'rate limit exceeded' }, { 'retry-after': String(retryAfter) });
        finishAudit('rate_limit_rejected', 429, 'rate_limited');
        return;
      }
      const concurrency = concurrencyLimiter.acquire(client.clientId);
      if (!concurrency.allowed) {
        sendJson(
          res,
          429,
          { error: 'concurrency limit exceeded' },
          { 'retry-after': String(concurrency.retryAfterSeconds) },
        );
        finishAudit('concurrency_rejected', 429, 'concurrency_limited');
        return;
      }
      const releaseConcurrency = concurrency.release;
      let concurrencyReleased = false;
      const releaseOnce = () => {
        if (concurrencyReleased) return;
        concurrencyReleased = true;
        releaseConcurrency!();
      };
      res.once('finish', releaseOnce);
      res.once('close', releaseOnce);
      lifecycle = requestRegistry.begin(requestId, req, res);
      sessionId = headerValue(req, 'mcp-session-id');
      let session: Session;
      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) {
          sendJson(res, 404, { error: 'unknown MCP session' });
          finishAudit('request_completed', 404, 'unknown_session');
          return;
        }
        session = existing;
        if (session.policy.clientId !== client.clientId) {
          sendJson(res, 403, { error: 'MCP session belongs to another client' });
          finishAudit('request_completed', 403, 'session_client_mismatch');
          return;
        }
      } else {
        session = await createSession(client, config, createMcpServer, sessions);
      }
      await runWithHttpRequestContext(lifecycle!, () =>
        withRequestTimeout(req, res, config.requestTimeoutMs, lifecycle!, () =>
          session.transport.handleRequest(req, res),
        ),
      );
      finishAudit('request_completed', res.statusCode || 200, lifecycle.signal.aborted ? 'cancelled' : 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal server error';
      if (!res.headersSent) sendJson(res, lifecycle?.signal.aborted ? 499 : 500, { error: message });
      finishAudit(
        'request_error',
        res.statusCode || 500,
        lifecycle?.signal.aborted ? 'cancelled' : 'internal_error',
        message,
      );
    } finally {
      // The response finish/close handlers release the concurrency slot.
    }
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const instance: HttpServerInstance = {
    httpServer,
    close: async () => {
      if (closePromise) return closePromise;
      closePromise = (async () => {
        shuttingDown = true;
        audit.record({ event: 'shutdown_started' });
        requestRegistry.abortAll(new Error('server is shutting down'));
        const serverClosed = new Promise<void>((resolve, reject) =>
          httpServer.close((error) => (error ? reject(error) : resolve())),
        );
        await requestRegistry.waitForEmpty(config.shutdownTimeoutMs ?? 10_000);
        await serverClosed;
        await Promise.all([...sessions.values()].map(({ transport }) => transport.close()));
        audit.record({ event: 'shutdown_completed' });
        await audit.flush();
      })();
      return closePromise;
    },
  };
  return instance;
}

async function createSession(
  client: HttpClientConfig,
  config: StreamableHttpConfig,
  createMcpServer: (policy: McpClientPolicy) => McpServer,
  sessions: Map<string, Session>,
): Promise<Session> {
  const policy = createClientPolicy(client);
  let sessionId = '';
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id) => {
      sessionId = id;
      sessions.set(id, session);
    },
    onsessionclosed: async (id) => {
      const existing = sessions.get(id);
      sessions.delete(id);
      await existing?.transport.close();
    },
    allowedOrigins: config.allowedOrigins,
    allowedHosts: config.allowedHosts,
    enableDnsRebindingProtection: true,
  });
  const server = createMcpServer(policy);
  const session = { transport, server, policy };
  transport.onclose = () => {
    if (sessionId) sessions.delete(sessionId);
  };
  await server.connect(transport);
  return session;
}

function authenticate(
  req: IncomingMessage,
  clients: readonly RotatingHttpClientConfig[],
): RotatingHttpClientConfig | undefined {
  const value = headerValue(req, 'authorization');
  if (!value?.startsWith('Bearer ')) return undefined;
  const token = value.slice('Bearer '.length);
  return clients.find(
    (client) => (!client.expiresAt || Date.parse(client.expiresAt) > Date.now()) && tokensEqual(token, client.token),
  );
}

function validateSecurityHeaders(req: IncomingMessage, config: StreamableHttpConfig): string | undefined {
  const host = headerValue(req, 'host');
  if (!host || !config.allowedHosts.includes(host)) return `Invalid Host header: ${host ?? ''}`;
  const origin = headerValue(req, 'origin');
  if (!origin || !config.allowedOrigins.includes(origin)) return `Invalid Origin header: ${origin ?? ''}`;
  return undefined;
}

function tokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseClients(env: NodeJS.ProcessEnv): HttpClientConfig[] {
  const raw = env.MCP_HTTP_AUTH_TOKENS;
  if (raw) {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error('MCP_HTTP_AUTH_TOKENS must be a JSON array');
    return parsed.map((entry, index) => parseClient(entry, index));
  }
  const token = env.MCP_HTTP_BEARER_TOKEN;
  if (!token) return [];
  return [
    {
      token,
      clientId: env.MCP_HTTP_CLIENT_ID ?? 'local-client',
      scopes: parseScopes(splitList(env.MCP_HTTP_SCOPES ?? 'read,run,write'), 'MCP_HTTP_SCOPES'),
      projectRoots: splitList(env.MCP_HTTP_PROJECT_ROOTS ?? process.cwd()),
      evidenceRoots: splitList(env.MCP_HTTP_EVIDENCE_ROOTS ?? `${process.cwd()}/runs`),
    },
  ];
}

function parseClient(value: unknown, index: number): HttpClientConfig {
  if (!value || typeof value !== 'object') throw new Error(`MCP_HTTP_AUTH_TOKENS[${index}] must be an object`);
  const entry = value as Record<string, unknown>;
  const token = stringField(entry, 'token', index);
  const clientId = stringField(entry, 'clientId', index);
  const scopes = stringArrayField(entry, 'scopes', index);
  parseScopes(scopes, `MCP_HTTP_AUTH_TOKENS[${index}].scopes`);
  const projectRoots = stringArrayField(entry, 'projectRoots', index);
  const evidenceRoots = stringArrayField(entry, 'evidenceRoots', index);
  const expiresAt = entry.expiresAt;
  if (expiresAt !== undefined && (typeof expiresAt !== 'string' || Number.isNaN(Date.parse(expiresAt))))
    throw new Error(`MCP_HTTP_AUTH_TOKENS[${index}].expiresAt is invalid`);
  return {
    token,
    clientId,
    scopes: scopes as McpPermission[],
    projectRoots,
    evidenceRoots,
    expiresAt: expiresAt as string | undefined,
  };
}

function parseScopes(scopes: string[], label: string): McpPermission[] {
  const allowedScopes = new Set<McpPermission>(['read', 'run', 'write', 'admin']);
  if (!scopes.every((scope) => allowedScopes.has(scope as McpPermission))) {
    throw new Error(`${label} contains an invalid permission`);
  }
  return scopes as McpPermission[];
}

function stringField(entry: Record<string, unknown>, field: string, index: number): string {
  const value = entry[field];
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`MCP_HTTP_AUTH_TOKENS[${index}].${field} is required`);
  return value;
}

function stringArrayField(entry: Record<string, unknown>, field: string, index: number): string[] {
  const value = entry[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    throw new Error(`MCP_HTTP_AUTH_TOKENS[${index}].${field} must be a non-empty string array`);
  }
  return value as string[];
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function integerEnv(value: string | undefined, fallback: number, name: string, allowZero = false): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0))
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function withRequestTimeout(
  req: IncomingMessage,
  res: ServerResponse,
  timeoutMs: number,
  lifecycle: ReturnType<HttpRequestRegistry['begin']>,
  operation: () => Promise<void>,
): Promise<void> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    lifecycle.abort(new Error('HTTP request timed out'));
    if (!res.headersSent) sendJson(res, 408, { error: 'request timeout' });
    req.destroy();
  }, timeoutMs);
  try {
    await operation();
  } finally {
    clearTimeout(timer);
    if (timedOut && !res.writableEnded) res.end();
  }
}
function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}
