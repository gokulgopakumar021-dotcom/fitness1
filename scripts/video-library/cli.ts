/** Tiny argv helpers shared by the video-library scripts. */

export class UsageError extends Error {}

/**
 * Returns the value following `--name`, undefined when the flag is absent. A flag that is present but has no value
 * (or whose "value" is another flag) is an error, so `--sample-file --execute` can never swallow `--execute`.
 */
export function optionValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new UsageError(`--${name} needs a value`);
  return v;
}
