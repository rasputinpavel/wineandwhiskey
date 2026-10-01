/** Minimal argv helper shared by the trend CLI: pull the values that follow a flag. */

export function valuesAfter(args: string[], flag: string): string[] {
  const i = args.indexOf(flag)
  if (i === -1) return []
  const out: string[] = []
  for (const a of args.slice(i + 1)) {
    if (a.startsWith('--')) break
    out.push(a)
  }
  return out
}
