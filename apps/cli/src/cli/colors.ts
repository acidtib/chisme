/**
 * Colors are disabled when stdout is not a TTY or `NO_COLOR` is set
 * (https://no-color.org); each helper is then a no-op string wrapper.
 */
const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function wrap(open: number, close: number): (s: string) => string {
  return (s: string) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
}

export const colors = {
  enabled,
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
};
