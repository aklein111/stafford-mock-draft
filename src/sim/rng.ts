// Seeded random number generator (spec §6) so a draft with the same seed
// always plays out the same way. mulberry32 is a small, well-known PRNG —
// good enough for a simulation, not for anything cryptographic.

export type RNG = () => number

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Random integer in [min, max], inclusive.
export function randInt(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

// Random float in [min, max).
export function randRange(rng: RNG, min: number, max: number): number {
  return rng() * (max - min) + min
}

// Approximate standard-normal sample (Box-Muller), scaled to mean/sd.
export function randNormal(rng: RNG, mean = 0, sd = 1): number {
  const u1 = Math.max(rng(), Number.EPSILON)
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * sd
}
