import type { Verdict } from "./types.js";

interface Entry { verdict: Verdict; at: number; }

export class SessionStore {
  private map = new Map<number, Entry>();
  constructor(
    private ttlMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  setVerdict(chatId: number, verdict: Verdict): void {
    this.map.set(chatId, { verdict, at: this.now() });
  }

  getVerdict(chatId: number): Verdict | undefined {
    const e = this.map.get(chatId);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.map.delete(chatId); return undefined; }
    return e.verdict;
  }
}
