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
  let ended = false;
  let seenHeader = false;
  while (p < data.length) {
    if (p + 12 > data.length) throw new Error('truncated PNG chunk');
    const n = readU32(data, p);
    if (n > data.length - p - 12) throw new Error('truncated PNG data');
    if (crc32(data.subarray(p + 4, p + 8 + n)) !== readU32(data, p + 8 + n)) throw new Error('invalid PNG CRC');
    const t = data.toString('ascii', p + 4, p + 8);
    const c = data.subarray(p + 8, p + 8 + n);
    p += 12 + n;
    if (!seenHeader && t !== 'IHDR') throw new Error('missing PNG header');
    if (t === 'IHDR') {
      if (seenHeader || n !== 13) throw new Error('invalid PNG header');
      seenHeader = true;
      w = readU32(c, 0);
      h = readU32(c, 4);
      depth = c[8];
      type = c[9];
      interlace = c[12];
    } else if (t === 'IDAT') raw = Buffer.concat([raw, c]);
    else if (t === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended || p !== data.length || w < 1 || h < 1 || w * h > 16777216)
    throw new Error('invalid PNG dimensions or end');
  if (depth !== 8 || interlace !== 0 || ![2, 6].includes(type))
    throw new Error('PNG requires 8-bit non-interlaced RGB/RGBA');
  const bpp = type === 6 ? 4 : 3,
    stride = w * bpp,
    inflated = inflateSync(raw, { maxOutputLength: h * (stride + 1) }),
    out = Buffer.alloc(h * stride);
  if (inflated.length !== h * (stride + 1)) throw new Error('invalid PNG scanline length');
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = inflated[q++],
      row = y * stride;
    if (f > 4) throw new Error('invalid PNG filter');
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

type SceneResourceValue =
  | string
  | number
  | boolean
  | null
  | SceneResourceValue[]
  | { [key: string]: SceneResourceValue };
function parseSceneValue(raw: string): SceneResourceValue {
  const value = raw.trim();
  const ref = value.match(/^(ExtResource|SubResource)\("([^"]+)"\)$/);
  if (ref) return { kind: ref[1] === 'ExtResource' ? 'external' : 'sub', id: ref[2] } as unknown as SceneResourceValue;
  if (value === 'null') return null;
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']'))
    return value.slice(1, -1).trim() ? value.slice(1, -1).split(',').map(parseSceneValue) : [];
  return value;
}
function headerAttributes(line: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /(\w+)=((?:"[^"]*")|(?:[^\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) result[m[1]] = m[2].replace(/^"|"$/g, '');
  return result;
}
/** Parse a Godot text scene into a navigable resource dependency graph. */
export function parseSceneResourceGraph(content: string, scenePath = '') {
  const lines = content.split(/\r?\n/),
    extResources: any[] = [],
    subResources: any[] = [],
    nodes: any[] = [];
  const reverseDependencies: Record<string, string[]> = {};
  let current: any;
  const addRef = (id: string, target: string) => {
    (reverseDependencies[id] ??= []).push(target);
  };
  for (const line of lines) {
    if (!line.trim() || line.startsWith(';')) continue;
    const section = line.match(/^\[(\w+)(?:\s+([^\]]+))?\]/);
    if (section) {
      const attrs = headerAttributes(section[2] ?? '');
      if (section[1] === 'ext_resource') {
        current = {
          id: attrs.id ?? '',
          type: attrs.type ?? '',
          path: attrs.path ?? '',
          properties: {},
          dependencies: [],
        };
        extResources.push(current);
      } else if (section[1] === 'sub_resource') {
        current = { id: attrs.id ?? '', type: attrs.type ?? '', properties: {}, dependencies: [] };
        subResources.push(current);
      } else if (section[1] === 'node') {
        const parent = attrs.parent ?? '.';
        current = {
          id: nodes.length,
          name: attrs.name ?? '',
          type: attrs.type ?? '',
          parent,
          path: parent === '.' ? (attrs.name ?? '') : parent + '/' + (attrs.name ?? ''),
          properties: {},
          resourceRefs: [],
          instance: attrs.instance,
        };
        nodes.push(current);
        if (attrs.instance) {
          const r = attrs.instance.match(/ExtResource\("([^"]+)/);
          if (r) {
            current.resourceRefs.push(r[1]);
            addRef(r[1], current.path + '.instance');
          }
        }
      } else current = undefined;
      continue;
    }
    const property = line.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!property || !current) continue;
    const key = property[1],
      parsed = parseSceneValue(property[2]);
    current.properties[key] = parsed;
    for (const r of property[2].matchAll(/(ExtResource|SubResource)\("([^"]+)"\)/g)) {
      const id = r[2];
      current.resourceRefs?.push(id);
      addRef(id, (current.path ?? current.id) + '.' + key);
      current.dependencies?.push(id);
    }
  }
  const sceneLine = lines.find((l) => l.startsWith('[gd_scene'));
  const sceneAttrs = headerAttributes(sceneLine?.replace(/^\[gd_scene\s*|\]$/g, '') ?? '');
  const inherited = extResources.find((r) => r.type === 'PackedScene');
  return {
    scenePath,
    format: sceneAttrs.format,
    loadSteps: Number(sceneAttrs.load_steps) || undefined,
    extResources,
    subResources,
    nodes,
    inheritedScene: inherited ? { path: inherited.path, type: inherited.type, ref: inherited.id } : undefined,
    reverseDependencies,
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
/**
 * Returns true if this Godot engine diagnostic line is known to be harmless noise
 * produced only by headless / no-session / CI environments — NOT a user-code failure.
 *
 * Godot on any headless run emits ERROR:/WARNING: lines for:
 *   - Editor cache & settings files it can't write (AppData, ~/.local/share/godot)
 *   - Missing Linux display session (X11, D-Bus, Wayland, xcb, xkbcommon)
 *   - Audio driver init failures (alsa, pulse, wasapi, coreaudio)
 *   - GPU/GL driver issues in containers (OpenGL, EGL, GLX, Vulkan, libGL)
 *   - FreeType / fontconfig misses (no fonts in container)
 * None of these mean the game script broke — they're engine-side environmental
 * complaints. Real script errors are identified later via SCRIPT ERROR / res://
 * locations / push_error output.
 */
function isEngineNoise(message: string) {
  const m = message;
  return (
    // Editor persistence (all platforms, headless)
    /editor_doc_cache|editor_settings/.test(m) ||
    /Cannot (?:create|save) (?:file|editor help cache)/i.test(m) ||
    /Error saving editor settings/i.test(m) ||
    // Linux display session
    /X11|D-Bus|dbus|xcb|xkbcommon|Wayland|wayland/i.test(m) ||
    // Audio driver init
    /AudioDriver|audio driver|alsa|wasapi|pulse|coreaudio/i.test(m) ||
    // GPU / GL driver (containers often lack libGL)
    /\bOpenGL\b|glad|libGL|libEGL|libGLX|EGL_|GLX_|Vulkan|vulkan/i.test(m) ||
    // Font system (containers often have no fonts)
    /freetype|fontconfig|font file/i.test(m) ||
    // Process / memory utils
    /cgroup|process_swap|get_total_memory|get_free_memory/i.test(m)
  );
}
export async function readGodotDiagnostics(evidenceDir: string, projectPath?: string) {
  const root = projectPath ? path.resolve(projectPath) : undefined;
  const diagnostics: Array<{
    severity: 'warning' | 'error';
    kind: string;
    message: string;
    file?: string;
    line?: number;
    column?: number;
    stack: Array<{ file: string; line: number; column?: number }>;
    fingerprint: string;
    occurrences: number;
    source: string;
  }> = [];
  for (const name of ['stderr.log', 'debug-output.log', 'stdout.log']) {
    const lines = (await readFile(path.join(path.resolve(evidenceDir), name), 'utf8').catch(() => ''))
      // Godot console output may include ANSI escape sequences.
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      // Recognize engine diagnostic headers, not user text such as "error count: 0".
      if (!/^\s*(?:SCRIPT ERROR:|ERROR:|WARNING:|Parse Error:|Parser Error:)/.test(line)) continue;
      // Noise filter: in headless CI, Godot emits engine-level ERROR:/WARNING: lines
      // that are NOT user-code failures. We filter out known headless-noise patterns
      // but keep everything else — including push_error() calls (which have no file
      // path on the header line and must NOT be dropped).
      const trimmed = line.trim();
      if (isEngineNoise(trimmed)) continue;
      const kind = /Parse[r]? Error/i.test(line) ? 'parser' : /^\s*WARNING:/.test(line) ? 'warning' : 'runtime';
      const message = trimmed;
      const stack: Array<{ file: string; line: number; column?: number }> = [];
      const addLocation = (text: string) => {
        const m = text.match(/((?:res:\/\/|[A-Za-z]:[\\/])[^\r\n]*?\.(?:gd|tscn|cs)):(\d+)(?::(\d+))?/);
        if (!m) return;
        const frame = {
          file: root ? virtual(root, m[1]).virtualPath : m[1],
          line: Number(m[2]),
          ...(m[3] ? { column: Number(m[3]) } : {}),
        };
        if (!stack.some((f) => f.file === frame.file && f.line === frame.line && f.column === frame.column))
          stack.push(frame);
      };
      addLocation(line);
      for (let next = index + 1; next < lines.length; next++) {
        if (!/^\s+(?:at:|\[\d+\]|GDScript backtrace|C\+\+ backtrace)/.test(lines[next])) break;
        addLocation(lines[next]);
      }
      // Keep numeric values in the message: error 10 and error 20 can represent different defects.
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([kind, message, stack]))
        .digest('hex')
        .slice(0, 16);
      const previous = diagnostics.find((d) => d.fingerprint === fingerprint);
      if (previous) {
        previous.occurrences++;
        continue;
      }
      diagnostics.push({
        severity: kind === 'warning' ? 'warning' : 'error',
        kind,
        message,
        ...stack[0],
        stack,
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

export async function analyzeCollisions(projectPath: string, scenePath: string) {
  const scene = await readSceneFile(projectPath, scenePath);
  const lines = scene.content.split(/\r?\n/);
  const ext = new Map<string, string>();
  const nodes: any[] = [];
  for (const line of lines) {
    const e = line.match(/^\[ext_resource\s+path="([^"]+)"[^\n]*id="([^"]+)"/);
    if (e) ext.set(e[2], e[1]);
    const n = line.match(/^\[node\s+name="([^"]+)"[^\n]*type="([^"]+)"(?:[^\n]*parent="([^"]+)")?/);
    if (n)
      nodes.push({
        name: n[1],
        type: n[2],
        parent: n[3] ?? '.',
        path: n[3] ? `${n[3]}/${n[1]}` : n[1],
        properties: {},
      });
    const pr = line.match(/^([a-zA-Z_][\w]*)\s*=\s*(.+)$/);
    if (pr && nodes.length) nodes[nodes.length - 1].properties[pr[1]] = pr[2];
  }
  const collisions = nodes.filter((n) => /Body|Area|Collision|RayCast|Shape/.test(n.type));
  const warnings: any[] = [];
  for (const n of collisions) {
    if (/CollisionShape|CollisionPolygon/.test(n.type) && (!n.properties.shape || n.properties.shape === 'null'))
      warnings.push({ code: 'EMPTY_COLLISION_SHAPE', nodePath: n.path });
    if (n.properties.collision_layer && n.properties.collision_mask) {
      const layer = Number(n.properties.collision_layer),
        mask = Number(n.properties.collision_mask);
      if (layer > 0 && mask === 0)
        warnings.push({ code: 'LAYER_MASK_MISMATCH', nodePath: n.path, collisionLayer: layer, collisionMask: mask });
    }
    n.resource = n.properties.shape
      ? (ext.get(String(n.properties.shape).match(/ExtResource\("([^"]+)/)?.[1] ?? '') ?? n.properties.shape)
      : undefined;
    n.transform = n.properties.transform ?? n.properties.position ?? undefined;
  }
  return {
    schema_version: '0.1',
    source: 'REAL',
    scenePath: scene.scenePath,
    nodes: collisions,
    collisionCount: collisions.length,
    warnings,
  };
}
export async function getNodeSemantics(projectPath: string, scenePath: string) {
  const scene = await readSceneFile(projectPath, scenePath);
  const result: any[] = [];
  for (const line of scene.content.split(/\r?\n/)) {
    const m = line.match(/^\[node\s+name="([^"]+)"[^\n]*type="([^"]+)"[^\n]*(?:parent="([^"]+)")?/);
    if (!m) continue;
    const type = m[2],
      name = m[1].toLowerCase();
    const semantic = /player|hero/.test(name)
      ? 'player'
      : /enemy|mob/.test(name)
        ? 'enemy'
        : /button|label|panel|ui/.test(name) || type.startsWith('Control')
          ? 'ui'
          : /camera/.test(name) || type.includes('Camera')
            ? 'camera'
            : /item|pickup|coin|weapon/.test(name)
              ? 'interactive'
              : 'node';
    result.push({ path: m[3] ? `${m[3]}/${m[1]}` : m[1], name: m[1], type, semantic, components: [type] });
  }
  return { schema_version: '0.1', source: 'REAL', scenePath: scene.scenePath, nodes: result };
}
