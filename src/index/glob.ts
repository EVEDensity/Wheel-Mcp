import { WheelError } from '../error-schema.js';

/** '*' and '?' only; no user-authored regular expression or exponential regex backtracking. */
export function compileProjectGlob(pattern: string): (value: string) => boolean {
  if (pattern.length > 256 || pattern.includes('\0'))
    throw new WheelError('INVALID_ARGUMENT', 'Search glob exceeds budget');
  return (value) => {
    let input = 0,
      token = 0,
      star = -1,
      retry = 0;
    while (input < value.length) {
      if (pattern[token] === '?' || pattern[token] === value[input]) {
        input++;
        token++;
      } else if (pattern[token] === '*') {
        star = token++;
        retry = input;
      } else if (star >= 0) {
        token = star + 1;
        input = ++retry;
      } else return false;
    }
    while (pattern[token] === '*') token++;
    return token === pattern.length;
  };
}
