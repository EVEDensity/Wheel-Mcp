import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { classifyError } from '../error-schema.js';
import { createTimeoutContext, type TimeoutContext } from '../timeout.js';
import type { McpToolResult } from '../tool-types.js';
import { createUnifiedResponse } from '../response-types.js';
import { timeoutMsSchema } from '../input-schemas.js';
import { DEFAULT_COMMAND_TIMEOUT_MS } from '../timeouts.js';

export const toolSchemas = {
  projectPath: z.string(),
  godotPath: z.string().optional(),
  bridgePath: z.string(),
  evidenceDir: z.string().optional(),
  timeoutMs: timeoutMsSchema,
  responseMode: z.enum(['compact', 'normal', 'verbose']).optional(),
  cursor: z
    .union([
      z.number().int().nonnegative(),
      z.object({ run_id: z.string().min(1), sequence: z.number().int().nonnegative() }),
    ])
    .optional(),
  eventNames: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  eventPayload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
