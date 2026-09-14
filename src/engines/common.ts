import type { Vec3 } from '../harness/types';

export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const srgb3 = (v: Vec3): Vec3 => [linearToSrgb(v[0]), linearToSrgb(v[1]), linearToSrgb(v[2])];
export const deg = (d: number) => (d * Math.PI) / 180;
