import { createHash } from 'node:crypto';

// Fixed digests from the official godotengine/godot 4.7.2-stable release assets.
export const godotArchives = {
  win32: {
    name: 'Godot_v4.7.2-stable_win64.exe.zip',
    sha256: '731980f9608d61333e5baf54a2ef17210acc7a538446c0cb9969f002aca1e953',
  },
  linux: {
    name: 'Godot_v4.7.2-stable_linux.x86_64.zip',
    sha256: 'cadd3204e728a35d3f13adb7fd0d7902636b79f6b95c40c265eb73b6c35329e4',
  },
  darwin: {
    name: 'Godot_v4.7.2-stable_macos.universal.zip',
    sha256: 'c58a24e31d720be9d62f60cb5627c4e695fb72f21b0cfe1bc9ccaa9a3b3ba63e',
  },
};
export function verifyArchive(bytes, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('Godot archive SHA-256 mismatch; refusing to extract or execute');
}
export function validateDownloadUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)
  )
    throw new Error('Godot download URL is outside the official HTTPS release hosts');
  return url;
}
