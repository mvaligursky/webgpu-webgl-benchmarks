/** mulberry32 — tiny, fast, and identical in every JS engine. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + (max - min) * next(),
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    /** Uniform random unit vector. */
    unit(out: number[] = [0, 0, 0]) {
      const z = next() * 2 - 1;
      const phi = next() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      out[0] = r * Math.cos(phi);
      out[1] = r * Math.sin(phi);
      out[2] = z;
      return out;
    },
  };
}

export type Rng = ReturnType<typeof rng>;
