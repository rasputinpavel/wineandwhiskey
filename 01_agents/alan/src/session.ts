import type { Verdict, Lang } from "./types.js";

interface Entry { verdict: Verdict; lang: Lang; at: number; }

export class SessionStore {
  private map = new Map<number, Entry>();
  constructor(
    private ttlMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  set(key: number, verdict: Verdict, lang: Lang): void {
    this.map.set(key, { verdict, lang, at: this.now() });
  }

  get(key: number): { verdict: Verdict; lang: Lang } | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.map.delete(key); return undefined; }
    return { verdict: e.verdict, lang: e.lang };
  }
}
