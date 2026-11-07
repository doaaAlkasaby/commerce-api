import { metrics } from './metrics.js';
export class Readiness {
  draining = false;
  private probeFlight: Promise<unknown> | undefined;
  private cached?: { at: number; ok: boolean };
  private pending: Promise<boolean> | undefined;
  constructor(
    private readonly probe: () => Promise<unknown>,
    private readonly ttlMs = 2000,
    private readonly timeoutMs = 1500,
    private readonly now = Date.now,
  ) {}
  async check(): Promise<boolean> {
    if (this.draining) return false;
    if (this.cached && this.now() - this.cached.at < this.ttlMs)
      return this.cached.ok;
    if (this.pending) return (await this.pending) && !this.draining;
    this.pending = this.run();
    try {
      return (await this.pending) && !this.draining;
    } finally {
      this.pending = undefined;
    }
  }
  private async run(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!this.probeFlight) {
        const flight = Promise.resolve().then(this.probe);
        this.probeFlight = flight;
        void flight.then(
          () => {
            if (this.probeFlight === flight) this.probeFlight = undefined;
          },
          () => {
            if (this.probeFlight === flight) this.probeFlight = undefined;
          },
        );
      }
      await Promise.race([
        this.probeFlight,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Probe deadline')),
            this.timeoutMs,
          );
        }),
      ]);
      this.cached = { at: this.now(), ok: true };
      return true;
    } catch {
      metrics.increment(
        'commerce_database_connectivity_failures_total',
        'source="readiness"',
      );
      this.cached = { at: this.now(), ok: false };
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
