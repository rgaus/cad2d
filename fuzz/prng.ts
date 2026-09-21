/**
 * Deterministic seeded PRNG for the fuzzer.
 *
 * Every worker gets a distinct seed, and every op sequence is generated from
 * that seed. Recording the seed in the bug report lets us reproduce the
 * exact same walk again.
 */

/** A seeded PRNG (mulberry32). Provides a stable sequence across runs. */
export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Returns the current seed (for logging / reproduction). */
  getSeed(): number {
    return this.state;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Next float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Next integer in [0, n). */
  index(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Picks a random element from an array. */
  pick<A>(items: Array<A>): A {
    if (items.length === 0) {
      throw new Error('PRNG.pick: empty array');
    }
    return items[this.index(items.length)];
  }

  /** Shuffles a copy of the array using the Fisher-Yates algorithm. */
  shuffle<A>(items: Array<A>): Array<A> {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = this.index(i + 1);
      const tmp = result[i];
      result[i] = result[j];
      result[j] = tmp;
    }
    return result;
  }

  /** Returns true with probability p (0..1). */
  chance(p: number): boolean {
    return this.next() < p;
  }
}
