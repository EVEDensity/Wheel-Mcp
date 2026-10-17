const commitPattern = /^[a-f0-9]{40}$/;
export function releaseChanges(changelog, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid changelog version');
  const sections = changelog.split(/^## /m).slice(1);
  const section = sections.find((text) => text.split(/\r?\n/, 1)[0].trim() === version);
  if (!section) throw new Error(`Missing exact changelog section for ${version}`);
  const changes = section.replace(/^[^\n]*\n/, '').trim();
  if (!changes) throw new Error(`Empty changelog section for ${version}`);
  return changes;
}
export function validateReleaseContext({ version, ref, head, tagHead, mainContains }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Only stable semantic versions can be released');
  const tag = `v${version}`;
  if (!['refs/heads/main', `refs/tags/${tag}`].includes(ref))
    throw new Error('Release must run from main or the exact version tag');
  if (!commitPattern.test(head) || !commitPattern.test(tagHead) || head !== tagHead)
    throw new Error('Release tag must already exist and match the checked-out commit');
  if (!mainContains) throw new Error('Release commit must be reachable from origin/main');
  return { tag, commit: head };
}
