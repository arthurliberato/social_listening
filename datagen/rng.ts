// Deterministic, seedable randomness. Every generation stream derives its own Rng from
// (seed, ...labels) so output never depends on iteration order or parallelism.

export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** mulberry32 */
  float(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.float() * n);
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.float();
  }
  bool(p: number): boolean {
    return this.float() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)] as T;
  }
  normal(): number {
    const u = 1 - this.float();
    const v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  lognormal(mu: number, sigma: number): number {
    return Math.exp(mu + sigma * this.normal());
  }
  exp(mean: number): number {
    return -Math.log(1 - this.float()) * mean;
  }
  /** Pareto with scale xm and tail index alpha (power-law followers/engagement). */
  pareto(xm: number, alpha: number): number {
    return xm / Math.pow(1 - this.float(), 1 / alpha);
  }
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 40) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.normal()));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.float();
    } while (p > L);
    return k - 1;
  }
  /** Index sampled proportionally to weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    return items[this.weighted(weights)] as T;
  }
}

export const rngFor = (seed: number, ...labels: (string | number)[]) =>
  new Rng(hashSeed(seed, ...labels));
