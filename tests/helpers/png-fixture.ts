import { deflateSync } from 'node:zlib';
export function pngChunk(kind: string, bytes: Buffer) {
  const name = Buffer.from(kind),
    length = Buffer.alloc(4),
    check = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, bytes])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, bytes, check]);
}
export function pixelPng(width = 2, height = 1, rgb = false) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = rgb ? 2 : 6;
  const bpp = rgb ? 3 : 4,
    rows = Buffer.alloc(height * (width * bpp + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const index = y * (width * bpp + 1) + 1 + x * bpp;
      rows[index] = x < Math.ceil(width / 2) ? 255 : 0;
      rows[index + 2] = x < Math.ceil(width / 2) ? 0 : 255;
      if (!rgb) rows[index + 3] = 255;
    }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
