import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClientPolicy, type McpClientPolicy, type McpPermission } from '../mcp/access-policy.js';

export type HttpClientConfig = {
  token: string;
  clientId: string;
  scopes: McpPermission[];
  projectRoots: string[];
  evidenceRoots: string[];
};

export type StreamableHttpConfig = {
  host: string;
  port: number;
  path: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  requestTimeoutMs: number;
  clients: HttpClientConfig[];
};

type Session = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  policy: McpClientPolicy;
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
  if (clients.length === 0) throw new Error('MCP HTTP requires MCP_HTTP_AUTH_TOKENS or MCP_HTTP_BEARER_TOKEN');
  const allowedOrigins = splitList(env.MCP_HTTP_ALLOWED_ORIGINS ?? `http://${host}:${port}`);
  const allowedHosts = splitList(env.MCP_HTTP_ALLOWED_HOSTS ?? `${host}:${port}`);
  if (allowedOrigins.length === 0 || allowedHosts.length === 0) {
    throw new Error('MCP HTTP requires non-empty allowed origins and hosts');
  }
  return { host, port, path, allowedOrigins, allowedHosts, requestTimeoutMs, clients };
}

export async function startStreamableHttpServer(
  config: StreamableHttpConfig,
  createMcpServer: (policy: McpClientPolicy) => McpServer,
): Promise<{ httpServer: Server; close: () => Promise<void> }> {
  const sessions = new Map<string, Session>();
  const httpServer = createServer(async (req, res) => {
    try {
      if (!req.url || new URL(req.url, `http://${req.headers.host ?? config.host}`).pathname !== config.path) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const client = authenticate(req, config.clients);
      if (!client) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      const headerError = validateSecurityHeaders(req, config);
      if (headerError) {
        sendJson(res, 403, { error: headerError });
        return;
      }
      const sessionId = headerValue(req, 'mcp-session-id');
      let session: Session;
      if (sessionId) {
        const existing = sessions.get(sessionId);
        if (!existing) {
          sendJson(res, 404, { error: 'unknown MCP session' });
          return;
        }
        session = existing;
        if (session.policy.clientId !== client.clientId) {
          sendJson(res, 403, { error: 'MCP session belongs to another client' });
          return;
        }
      } else {
        session = await createSession(client, config, createMcpServer, sessions);
      }
      await withRequestTimeout(req, res, config.requestTimeoutMs, () => session.transport.handleRequest(req, res));
    } catch (error) {
      if (!res.headersSent)
        sendJson(res, 500, { error: error instanceof Error ? error.message : 'internal server error' });
    }
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  return {
    httpServer,
    close: async () => {
      await Promise.all([...sessions.values()].map(async ({ transport }) => transport.close()));
      await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    },
  };
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

function authenticate(req: IncomingMessage, clients: readonly HttpClientConfig[]): HttpClientConfig | null {
  const value = headerValue(req, 'authorization');
  if (!value?.startsWith('Bearer ')) return null;
  const token = value.slice('Bearer '.length);
  return clients.find((client) => tokensEqual(token, client.token)) ?? null;
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
  return { token, clientId, scopes: scopes as McpPermission[], projectRoots, evidenceRoots };
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

function integerEnv(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
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
  operation: () => Promise<void>,
): Promise<void> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
