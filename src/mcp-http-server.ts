#!/usr/bin/env node
import { createMcpServer } from './mcp-server-sdk.js';
import { readStreamableHttpConfig, startStreamableHttpServer } from './transports/streamable-http.js';

const config = readStreamableHttpConfig();
const instance = await startStreamableHttpServer(config, createMcpServer);
const address = instance.httpServer.address();
console.error(
  `Wheel-mcp Streamable HTTP listening on ${typeof address === 'string' ? address : `${address?.address}:${address?.port}`}${config.path}`,
);

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await instance.close();
};
process.once('SIGINT', () => void close().finally(() => process.exit(0)));
process.once('SIGTERM', () => void close().finally(() => process.exit(0)));
