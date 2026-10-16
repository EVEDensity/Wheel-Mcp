/** Keep screenshot-only rendering away from the user's desktop. This is not headless rendering. */
export function backgroundRenderArguments(background: boolean): string[] {
  return background ? ['--windowed', '--position', '-32000,-32000', '--single-window'] : [];
}
