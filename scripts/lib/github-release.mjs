const commitPattern = /^[a-f0-9]{40}$/;
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
