import { readFile } from 'node:fs/promises';
import process from 'node:process';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = packageJson.version;
if (!/^0\.1\.0-preview\.\d+$/.test(version) && !/^0\.2\.0$/.test(version))
  throw new Error(`unsupported release version: ${version}`);
if (packageJson.bin['godot-harness-mcp'] !== 'build/src/mcp-server-sdk.js')
  throw new Error('MCP bin must use official SDK entrypoint');
if (packageJson.engines?.node !== '>=20') throw new Error('Node >=20 is required');
console.log(
  JSON.stringify(
    { status: 'PASS', version, node: process.version, checks: ['version', 'sdk-entrypoint', 'node-engine'] },
    null,
    2,
  ),
);
