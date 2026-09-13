import { appendFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type HttpAuditEvent = {
  timestamp?: string;
  event: string;
  requestId?: string;
  clientId?: string;
  method?: string;
  path?: string;
  mcpSessionId?: string;
  rpcMethod?: string;
  toolName?: string;
  status?: number;
  durationMs?: number;
  outcome?: string;
  remoteAddress?: string;
  reason?: string;
};

export class HttpAuditLogger {
  private pending = Promise.resolve();

  constructor(private readonly destination?: string) {}

  record(event: HttpAuditEvent): void {
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`;
    if (this.destination) {
      this.pending = this.pending.then(() => appendFile(this.destination!, line, 'utf8')).catch(() => undefined);
    } else {
      process.stderr.write(line);
    }
  }

  request(event: Omit<HttpAuditEvent, 'event'> & { event?: string }): void {
    this.record({ ...event, event: event.event ?? 'request_completed' });
  }

  async flush(): Promise<void> {
    await this.pending;
  }
}

export function requestAuditFields(req: IncomingMessage): Pick<HttpAuditEvent, 'method' | 'path' | 'remoteAddress'> {
  return {
    method: req.method,
    path: req.url ? new URL(req.url, `http://${req.headers.host ?? 'localhost'}`).pathname : undefined,
    remoteAddress: req.socket.remoteAddress,
  };
}

export function sendAuditResponse(res: ServerResponse, status: number): void {
  if (!res.headersSent) res.statusCode = status;
}
