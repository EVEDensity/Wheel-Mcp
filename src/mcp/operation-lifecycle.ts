import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CancelledError } from '../timeout.js';

/** Drain requests cooperatively before resource cleanup/process exit, including transaction rollback. */
export class McpOperationLifecycle {
  private readonly abort = new AbortController();
  private readonly active = new Set<Promise<void>>();
  private closing = false;
  async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closing) throw new CancelledError('MCP session is closing');
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.active.add(settled);
    try {
      return await operation(this.abort.signal);
    } finally {
      this.active.delete(settled);
      finish();
    }
  }
  async drain(): Promise<void> {
    this.closing = true;
    this.abort.abort(new CancelledError('MCP session closed'));
    await Promise.all([...this.active]);
  }
}
const lifecycles = new WeakMap<McpServer, McpOperationLifecycle>();
export function registerOperationLifecycle(server: McpServer): McpOperationLifecycle {
  const lifecycle = new McpOperationLifecycle();
  lifecycles.set(server, lifecycle);
  const originalClose = server.server.onclose;
  server.server.onclose = () => {
    originalClose?.();
    void lifecycle.drain();
  };
  return lifecycle;
}
export async function drainMcpOperations(server: McpServer): Promise<void> {
  await lifecycles.get(server)?.drain();
}
