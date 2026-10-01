import { createRequire } from 'node:module';

type PackageMetadata = { name: string; version: string };
const require = createRequire(import.meta.url);
const packageMetadata = require('../../package.json') as PackageMetadata;

export const serverInfo = { name: packageMetadata.name, version: packageMetadata.version } as const;
export const serverCapabilities = { tools: {}, logging: {}, resources: {}, prompts: {} } as const;
