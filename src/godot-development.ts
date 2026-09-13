import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

function inside(root: string, target: string): string {
  const r = path.resolve(root),
    t = path.resolve(target);
  if (t !== r && !t.startsWith(r + path.sep)) throw new Error('path must remain inside projectPath');
  return t;
}
function readU32(b: Buffer, o: number) {
  return b.readUInt32BE(o);
}
function decodePng(data: Buffer) {
  if (data.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) throw new Error('not a PNG');
  let p = 8,
    w = 0,
    h = 0,
    depth = 0,
    type = 0,
    interlace = 0,
    raw = Buffer.alloc(0);
  while (p < data.length) {
    const n = readU32(data, p);
    const t = data.toString('ascii', p + 4, p + 8);
    const c = data.subarray(p + 8, p + 8 + n);
    p += 12 + n;
    if (t === 'IHDR') {
      w = readU32(c, 0);
      h = readU32(c, 4);
      depth = c[8];
      type = c[9];
      interlace = c[12];
    } else if (t === 'IDAT') raw = Buffer.concat([raw, c]);
    else if (t === 'IEND') break;
  }
  if (depth !== 8 || interlace !== 0 || ![2, 6].includes(type))
    throw new Error('PNG requires 8-bit non-interlaced RGB/RGBA');
  const bpp = type === 6 ? 4 : 3,
    stride = w * bpp,
    inflated = inflateSync(raw),
    out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = inflated[q++],
      row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0,
        b = y ? out[row - stride + x] : 0,
        c = y && x >= bpp ? out[row - stride + x - bpp] : 0;
      let v = inflated[q++];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + Math.floor((a + b) / 2)) & 255;
      else if (f === 4) {
        const pp = a + b - c,
          pa = Math.abs(pp - a),
          pb = Math.abs(pp - b),
          pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      out[row + x] = v;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const k = Math.floor(i * bpp);
    rgba[j] = out[k];
    rgba[j + 1] = out[k + 1];
    rgba[j + 2] = out[k + 2];
    rgba[j + 3] = type === 6 ? out[k + 3] : 255;
  }
  return { width: w, height: h, rgba };
}
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const n of buf) {
    c ^= n;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function encodePng(w: number, h: number, rgba: Buffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (t: string, c: Buffer) => {
    const tb = Buffer.from(t);
    const x = Buffer.alloc(12 + c.length);
    x.writeUInt32BE(c.length, 0);
    tb.copy(x, 4);
    c.copy(x, 8);
    x.writeUInt32BE(crc32(Buffer.concat([tb, c])), 8 + c.length);
    return x;
  };
  const rows = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    rows[y * (w * 4 + 1)] = 0;
    rgba.copy(rows, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0);
  ih.writeUInt32BE(h, 4);
  ih[8] = 8;
  ih[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ih), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export async function readSceneFile(projectPath: string, scenePath: string) {
  const root = path.resolve(projectPath),
    file = inside(root, path.isAbsolute(scenePath) ? scenePath : path.join(root, scenePath)),
    content = await readFile(file, 'utf8');
  return {
    schema_version: '0.1',
    source: 'REAL',
    projectPath: root,
    scenePath: path.relative(root, file),
    content,
    bytes: Buffer.byteLength(content),
  };
}
export async function writeSceneFile(projectPath: string, scenePath: string, content: string) {
  const root = path.resolve(projectPath),
    file = inside(root, path.isAbsolute(scenePath) ? scenePath : path.join(root, scenePath));
  if (!file.endsWith('.tscn')) throw new Error('scenePath must point to a .tscn file');
  if (!content.includes('[gd_scene')) throw new Error('content is not a Godot scene');
  await writeFile(file, content, 'utf8');
  return {
    schema_version: '0.1',
    source: 'REAL',
    projectPath: root,
    scenePath: path.relative(root, file),
    bytes: (await stat(file)).size,
    saved: true,
  };
}
function virtual(root: string, f: string) {
  if (f.startsWith('res://')) return { virtualPath: f, absolutePath: inside(root, path.join(root, f.slice(6))) };
  return {
    virtualPath: root && path.isAbsolute(f) ? path.relative(root, f).replaceAll(path.sep, '/') : '',
    absolutePath: path.isAbsolute(f) ? f : undefined,
  };
}
export async function readGodotDiagnostics(evidenceDir: string, projectPath?: string) {
  const root = projectPath ? path.resolve(projectPath) : undefined,
    files = ['stderr.log', 'debug-output.log', 'stdout.log'],
    diagnostics: any[] = [];
  for (const name of files) {
    const text = await readFile(path.join(path.resolve(evidenceDir), name), 'utf8').catch(() => '');
    for (const line of text.split(/\r?\n/)) {
      if (!/(error|parser|invalid|failed|warning)/i.test(line)) continue;
      const m = line.match(
        /(?<file>(?:res:\/\/|[A-Za-z]:[\\/]|[^\s])[^:]*\.(?:gd|tscn)):(?<line>\d+)(?::(?<column>\d+))?/i,
      );
      const file = m?.groups?.file;
      const loc = file && root ? virtual(root, file) : undefined;
      const kind = /parser/i.test(line) ? 'parser' : /warning/i.test(line) ? 'warning' : 'runtime';
      const message = line.trim();
      const fingerprint = createHash('sha256')
        .update(`${kind}|${message.replace(/\d+/g, '#')}|${loc?.virtualPath ?? file ?? ''}|${m?.groups?.line ?? ''}`)
        .digest('hex')
        .slice(0, 16);
      const prev = diagnostics.find((d) => d.fingerprint === fingerprint);
      if (prev) {
        prev.occurrences++;
        continue;
      }
      diagnostics.push({
        severity: kind === 'warning' ? 'warning' : 'error',
        kind,
        message,
        file: loc?.virtualPath ?? file,
        line: m?.groups?.line ? Number(m.groups.line) : undefined,
        column: m?.groups?.column ? Number(m.groups.column) : undefined,
        stack: [],
        fingerprint,
        occurrences: 1,
        source: name,
      });
    }
  }
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: path.resolve(evidenceDir),
    projectPath: root,
    diagnostics,
  };
}
export async function readProjectFile(projectPath: string, filePath: string) {
  const root = path.resolve(projectPath),
    file = inside(root, path.isAbsolute(filePath) ? filePath : path.join(root, filePath)),
    content = await readFile(file, 'utf8');
  return {
    schema_version: '0.1',
    source: 'REAL',
    path: path.relative(root, file),
    content,
    bytes: Buffer.byteLength(content),
  };
}
export async function writeProjectFile(projectPath: string, filePath: string, content: string) {
  const root = path.resolve(projectPath),
    file = inside(root, path.isAbsolute(filePath) ? filePath : path.join(root, filePath));
  if (file.includes(`${path.sep}.git${path.sep}`) || file.includes(`${path.sep}.harness${path.sep}`))
    throw new Error('protected project path');
  await writeFile(file, content, 'utf8');
  return {
    schema_version: '0.1',
    source: 'REAL',
    path: path.relative(root, file),
    bytes: Buffer.byteLength(content),
    saved: true,
  };
}
export async function searchProject(
  projectPath: string,
  query: string,
  options: { glob?: string; maxResults?: number } = {},
) {
  const root = path.resolve(projectPath),
    max = options.maxResults ?? 100,
    results: any[] = [];
  async function walk(dir: string): Promise<void> {
    if (results.length >= max) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ['.godot', 'node_modules', '.harness'].includes(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) await walk(f);
      else if (!options.glob || new RegExp(options.glob.replace('.', '\\.').replace('*', '.*')).test(e.name)) {
        const t = await readFile(f, 'utf8').catch(() => '');
        t.split(/\r?\n/).forEach((l, i) => {
          if (results.length < max && l.toLowerCase().includes(query.toLowerCase()))
            results.push({ path: path.relative(root, f), line: i + 1, text: l.trim() });
        });
      }
    }
  }
  await walk(root);
  return { schema_version: '0.1', source: 'REAL', query, results };
}
export async function compareScreenshots(
  firstPath: string,
  secondPath: string,
  options: { threshold?: number; ignoreAlpha?: boolean; writeDiff?: boolean; diffPath?: string } = {},
) {
  const a = decodePng(await readFile(firstPath)),
    b = decodePng(await readFile(secondPath));
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`screenshot dimensions differ: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const threshold = options.threshold ?? 8,
    ignoreAlpha = options.ignoreAlpha ?? true,
    diff = Buffer.alloc(a.rgba.length),
    box = { left: a.width, top: a.height, right: -1, bottom: -1 };
  let differentPixels = 0,
    maxChannelDelta = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const j = i * 4,
      dr = Math.abs(a.rgba[j] - b.rgba[j]),
      dg = Math.abs(a.rgba[j + 1] - b.rgba[j + 1]),
      db = Math.abs(a.rgba[j + 2] - b.rgba[j + 2]),
      da = Math.abs(a.rgba[j + 3] - b.rgba[j + 3]);
    maxChannelDelta = Math.max(maxChannelDelta, dr, dg, db, da);
    const different = Math.max(dr, dg, db, ignoreAlpha ? 0 : da) > threshold;
    if (different) {
      differentPixels++;
      const x = i % a.width,
        y = Math.floor(i / a.width);
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
      diff[j] = 255;
      diff[j + 3] = 255;
    }
  }
  let diffPath: string | undefined;
  if (options.writeDiff) {
    diffPath = options.diffPath ? path.resolve(options.diffPath) : `${path.resolve(firstPath)}.diff.png`;
    if (path.resolve(diffPath) === path.resolve(firstPath) || path.resolve(diffPath) === path.resolve(secondPath))
      throw new Error('diffPath must not overwrite inputs');
    await writeFile(diffPath, encodePng(a.width, a.height, diff));
  }
  return {
    schema_version: '0.1',
    source: 'REAL',
    same: differentPixels === 0,
    width: a.width,
    height: a.height,
    threshold,
    ignoreAlpha,
    differentPixels,
    totalPixels: a.width * a.height,
    differenceRatio: differentPixels / (a.width * a.height),
    maxChannelDelta,
    boundingBox: differentPixels ? box : null,
    diffPath,
  };
}
export async function getRecentEvidence(evidenceDir: string) {
  const root = path.resolve(evidenceDir),
    files = await readdir(root, { withFileTypes: true });
  const entries = await Promise.all(
    files
      .filter((f) => f.isFile())
      .map(async (f) => {
        const file = path.join(root, f.name),
          info = await stat(file);
        return { name: f.name, bytes: info.size, modifiedAt: info.mtime.toISOString() };
      }),
  );
  return {
    schema_version: '0.1',
    source: 'REAL',
    evidenceDir: root,
    files: entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)),
  };
}
