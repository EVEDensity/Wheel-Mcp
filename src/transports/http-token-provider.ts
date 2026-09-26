import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import type { McpPermission } from '../mcp/access-policy.js';
import type { HttpClientConfig } from './streamable-http.js';

export type RotatingHttpClientConfig = HttpClientConfig & { expiresAt?: string };

export class HttpTokenProvider {
  private clients: RotatingHttpClientConfig[];
  private lastLoadedAt = 0;
  private reloadPromise?: Promise<void>;

  constructor(
    initialClients: readonly HttpClientConfig[],
    private readonly filePath?: string,
    private readonly reloadIntervalMs = 0,
  ) {
    this.clients = initialClients.map((client) => ({ ...client }));
  }

  getClients(now = Date.now()): readonly RotatingHttpClientConfig[] {
    this.reloadIfDue(now);
    return this.clients;
  }

  async reload(): Promise<boolean> {
    if (!this.filePath || !existsSync(this.filePath)) return false;
    if (this.reloadPromise) {
      await this.reloadPromise;
      return true;
    }
    this.reloadPromise = this.loadFile().finally(() => {
      this.reloadPromise = undefined;
    });
    await this.reloadPromise;
    return true;
  }

  private reloadIfDue(now: number): void {
    if (!this.filePath || this.reloadIntervalMs <= 0 || now - this.lastLoadedAt < this.reloadIntervalMs) return;
    this.lastLoadedAt = now;
    void this.reload();
  }

  private async loadFile(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath!, 'utf8')) as unknown;
      const clients = parseTokenFile(parsed);
      this.clients = clients;
    } catch {
      // Keep the last known-good token set. A malformed rotation file must not lock out all clients.
    }
  }

  static fromFile(
    initialClients: readonly HttpClientConfig[],
    filePath?: string,
    reloadIntervalMs = 0,
  ): HttpTokenProvider {
    const provider = new HttpTokenProvider(initialClients, filePath, reloadIntervalMs);
    if (filePath && reloadIntervalMs > 0) {
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
        provider.clients = parseTokenFile(parsed);
      } catch {
        // The configured environment remains the fallback until a valid file is available.
      }
    }
    return provider;
  }
}

function parseTokenFile(value: unknown): RotatingHttpClientConfig[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('token file must contain a non-empty array');
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`token file entry ${index} must be an object`);
    const item = entry as Record<string, unknown>;
    const token = nonEmptyString(item.token, `token file entry ${index}.token`);
    const clientId = nonEmptyString(item.clientId, `token file entry ${index}.clientId`);
    const scopes = item.scopes;
    const projectRoots = item.projectRoots;
    const evidenceRoots = item.evidenceRoots;
    const approvedGodotPaths = item.approvedGodotPaths;
    const approvedBridgePaths = item.approvedBridgePaths;
    if (!Array.isArray(scopes) || !scopes.every((scope) => ['read', 'run', 'write', 'admin'].includes(String(scope))))
      throw new Error(`token file entry ${index}.scopes is invalid`);
    if (!stringArray(projectRoots) || !stringArray(evidenceRoots))
      throw new Error(`token file entry ${index} roots are invalid`);
    if (
      (approvedGodotPaths !== undefined && !stringArrayAllowEmpty(approvedGodotPaths)) ||
      (approvedBridgePaths !== undefined && !stringArrayAllowEmpty(approvedBridgePaths))
    )
      throw new Error(`token file entry ${index} executable allowlists are invalid`);
    if (
      item.expiresAt !== undefined &&
      (typeof item.expiresAt !== 'string' || Number.isNaN(Date.parse(item.expiresAt)))
    )
      throw new Error(`token file entry ${index}.expiresAt is invalid`);
    return {
      token,
      clientId,
      scopes: scopes as McpPermission[],
      projectRoots,
      evidenceRoots,
      approvedGodotPaths: approvedGodotPaths as string[] | undefined,
      approvedBridgePaths: approvedBridgePaths as string[] | undefined,
      expiresAt: item.expiresAt as string | undefined,
    };
  });
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
  return value;
}
function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length > 0);
}
function stringArrayAllowEmpty(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);
}
