import { box, fieldGeometries } from './geometry';
import { rng, type Rng } from './rng';
import type {
  CameraSpec, CharactersScene, FieldScene, GltfScene, InstancesScene, ParticlesScene, PbrSpec,
  SceneData, ScenarioId, SunSpec, Vec3,
} from './types';

// Deterministic scene data for every scenario. Engines consume these arrays verbatim.

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const ASPECT = WIDTH / HEIGHT;

export interface AssetManifest {
  [name: string]: {
    url: string;
    /** POSITION accessor extents, ignoring node transforms (used for skinned characters). */
    bounds: { min: number[]; max: number[] };
    /** Static meshes with node transforms applied. */
    worldBounds: { min: number[]; max: number[] } | null;
    animations: string[];
  };
}

const CLEAR: Vec3 = [0.02, 0.02, 0.025];
const AMBIENT = { color: [0.6, 0.65, 0.75] as Vec3, intensity: 0.3 };
const GREY: PbrSpec = { color: [0.72, 0.72, 0.72], roughness: 0.5, metalness: 0 };

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

const sun = (extra?: Partial<SunSpec>): SunSpec => ({
  direction: norm([-0.4, -1, -0.3]),
  color: [1, 0.97, 0.92],
  intensity: 2.2,
  ...extra,
});

function hsvToLinear(h: number, s: number, v: number): Vec3 {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const srgb = [f(5), f(3), f(1)];
  return srgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as Vec3;
}

/** Per-object spin: random axis, speed and phase; update(t) writes quaternions. */
function spinner(r: Rng, count: number) {
  const axis = new Float32Array(count * 3);
  const speed = new Float32Array(count);
  const phase = new Float32Array(count);
  const tmp = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    r.unit(tmp);
    axis.set(tmp, i * 3);
    speed[i] = r.range(0.3, 1.5) * (r.next() < 0.5 ? -1 : 1);
    phase[i] = r.range(0, Math.PI * 2);
  }
  return (t: number, quat: Float32Array) => {
    for (let i = 0; i < count; i++) {
      const half = (phase[i] + speed[i] * t) * 0.5;
      const s = Math.sin(half);
      quat[i * 4] = axis[i * 3] * s;
      quat[i * 4 + 1] = axis[i * 3 + 1] * s;
      quat[i * 4 + 2] = axis[i * 3 + 2] * s;
      quat[i * 4 + 3] = Math.cos(half);
    }
  };
}

/** Uniformly scatter points inside the camera frustum between two distances, with a margin. */
function scatterInFrustum(r: Rng, cam: CameraSpec, count: number, near: number, far: number, margin: number) {
  const out = new Float32Array(count * 3);
  const tanHalf = Math.tan((cam.fovY * Math.PI) / 360);
  const cz = cam.position[2];
  for (let i = 0; i < count; i++) {
    const d = r.range(near, far);
    const halfH = Math.max(0, d * tanHalf - margin);
    const halfW = Math.max(0, d * tanHalf * ASPECT - margin);
    out[i * 3] = r.range(-halfW, halfW);
    out[i * 3 + 1] = r.range(-halfH, halfH);
    out[i * 3 + 2] = cz - d;
  }
  return out;
}

const FIELD_CAMERA: CameraSpec = { position: [0, 0, 40], target: [0, 0, 0], fovY: 50, near: 0.5, far: 200 };

/** Keeps total screen coverage roughly constant as N grows, so ladders isolate per-object cost. */
const coverageScale = (n: number, k = 3000, min = 0.2, max = 2) => Math.min(max, Math.max(min, Math.sqrt(k / n)));

function frustumField(seed: number, count: number, materials: PbrSpec[], materialPick: (r: Rng, i: number) => number): FieldScene {
  const r = rng(seed);
  const s = coverageScale(count);
  const geometries = fieldGeometries();
  const geom = new Uint8Array(count);
  const material = new Uint16Array(count);
  const scale = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    geom[i] = r.int(geometries.length);
    material[i] = materialPick(r, i);
    scale[i] = s * r.range(0.8, 1.2);
  }
  const position = scatterInFrustum(r, FIELD_CAMERA, count, 25, 55, s);
  const quat = new Float32Array(count * 4);
  const spin = spinner(r, count);
  spin(0, quat);
  return {
    kind: 'field',
    camera: { ...FIELD_CAMERA },
    clearColor: CLEAR,
    ambient: AMBIENT,
    sun: sun(),
    geometries,
    materials,
    count,
    geom,
    material,
    position,
    scale,
    quat,
    animated: true,
    shadows: false,
    update: (t) => spin(t, quat),
  };
}

function startup(): FieldScene {
  const quat = new Float32Array(4);
  const r = rng(1);
  const spin = spinner(r, 1);
  spin(0, quat);
  return {
    kind: 'field',
    camera: { position: [0, 1.2, 3], target: [0, 0, 0], fovY: 50, near: 0.1, far: 100 },
    clearColor: CLEAR,
    ambient: AMBIENT,
    sun: sun(),
    geometries: [box()],
    materials: [{ color: [0.8, 0.3, 0.1], roughness: 0.4, metalness: 0 }],
    count: 1,
    geom: new Uint8Array(1),
    material: new Uint16Array(1),
    position: new Float32Array(3),
    scale: new Float32Array([1]),
    quat,
    animated: true,
    shadows: false,
    update: (t) => spin(t, quat),
  };
}

function materialVariety(m: number): FieldScene {
  const r = rng(2000 + m);
  const materials: PbrSpec[] = [];
  for (let i = 0; i < m; i++) {
    materials.push({ color: hsvToLinear(r.next(), r.range(0.4, 0.9), r.range(0.5, 0.95)), roughness: r.range(0.2, 0.9), metalness: r.next() < 0.3 ? 0.6 : 0 });
  }
  return frustumField(2, 5000, materials, (rr) => rr.int(m));
}

function instances(count: number): InstancesScene {
  const r = rng(3);
  const s = coverageScale(count, 2000, 0.03, 2);
  const position = scatterInFrustum(r, FIELD_CAMERA, count, 25, 55, s);
  const scale = new Float32Array(count);
  for (let i = 0; i < count; i++) scale[i] = s * r.range(0.8, 1.2);
  const quat = new Float32Array(count * 4);
  const spin = spinner(r, count);
  const matrices = new Float32Array(count * 16);
  const update = (t: number) => {
    spin(t, quat);
    for (let i = 0; i < count; i++) {
      const x = quat[i * 4], y = quat[i * 4 + 1], z = quat[i * 4 + 2], w = quat[i * 4 + 3];
      const sc = scale[i];
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      const o = i * 16;
      matrices[o] = (1 - (yy + zz)) * sc;
      matrices[o + 1] = (xy + wz) * sc;
      matrices[o + 2] = (xz - wy) * sc;
      matrices[o + 3] = 0;
      matrices[o + 4] = (xy - wz) * sc;
      matrices[o + 5] = (1 - (xx + zz)) * sc;
      matrices[o + 6] = (yz + wx) * sc;
      matrices[o + 7] = 0;
      matrices[o + 8] = (xz + wy) * sc;
      matrices[o + 9] = (yz - wx) * sc;
      matrices[o + 10] = (1 - (xx + yy)) * sc;
      matrices[o + 11] = 0;
      matrices[o + 12] = position[i * 3];
      matrices[o + 13] = position[i * 3 + 1];
      matrices[o + 14] = position[i * 3 + 2];
      matrices[o + 15] = 1;
    }
  };
  update(0);
  return {
    kind: 'instances',
    camera: { ...FIELD_CAMERA },
    clearColor: CLEAR,
    ambient: AMBIENT,
    sun: sun(),
    geometry: box(),
    material: GREY,
    count,
    matrices,
    update,
  };
}

function pointLights(n: number): FieldScene {
  const r = rng(4);
  const grid = 20, spacing = 2.5, radius = 1.6;
  const count = grid * grid;
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    position[i * 3] = ((i % grid) - (grid - 1) / 2) * spacing;
    position[i * 3 + 1] = radius * 0.5;
    position[i * 3 + 2] = (Math.floor(i / grid) - (grid - 1) / 2) * spacing;
  }
  const quat = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) quat[i * 4 + 3] = 1;
  const lp = new Float32Array(n * 3), lc = new Float32Array(n * 3);
  const cx = new Float32Array(n), cz = new Float32Array(n), rad = new Float32Array(n), spd = new Float32Array(n), ph = new Float32Array(n), hy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    cx[i] = r.range(-24, 24);
    cz[i] = r.range(-24, 24);
    rad[i] = r.range(1, 4);
    spd[i] = r.range(0.3, 1.0) * (r.next() < 0.5 ? -1 : 1);
    ph[i] = r.range(0, Math.PI * 2);
    hy[i] = r.range(1, 3);
    lc.set(hsvToLinear(r.next(), 0.7, 1), i * 3);
  }
  const update = (t: number) => {
    for (let i = 0; i < n; i++) {
      const a = ph[i] + spd[i] * t;
      lp[i * 3] = cx[i] + rad[i] * Math.cos(a);
      lp[i * 3 + 1] = hy[i];
      lp[i * 3 + 2] = cz[i] + rad[i] * Math.sin(a);
    }
  };
  update(0);
  return {
    kind: 'field',
    camera: { position: [0, 22, 30], target: [0, 0, 2], fovY: 50, near: 0.5, far: 200 },
    clearColor: CLEAR,
    ambient: { color: AMBIENT.color, intensity: 0.08 },
    geometries: [fieldGeometries()[1]],
    materials: [{ color: [0.7, 0.7, 0.7], roughness: 0.35, metalness: 0.1 }],
    count,
    geom: new Uint8Array(count),
    material: new Uint16Array(count),
    position,
    scale: new Float32Array(count).fill(radius),
    quat,
    animated: false,
    ground: { size: 60, material: { color: [0.5, 0.5, 0.5], roughness: 0.8, metalness: 0 } },
    // Keep summed brightness roughly constant as the light count grows.
    pointLights: { count: n, position: lp, color: lc, intensity: 6 * Math.sqrt(8 / n), range: 7 },
    shadows: false,
    update,
  };
}

function shadowField(count: number, post: boolean): FieldScene {
  const r = rng(5);
  const geometries = fieldGeometries();
  const geom = new Uint8Array(count), material = new Uint16Array(count), scale = new Float32Array(count);
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    geom[i] = r.int(geometries.length);
    scale[i] = r.range(0.6, 1.4);
    position[i * 3] = r.range(-35, 35);
    position[i * 3 + 1] = r.range(0.6, 4);
    position[i * 3 + 2] = r.range(-35, 35);
  }
  const quat = new Float32Array(count * 4);
  const spin = spinner(r, count);
  spin(0, quat);
  const spot = (x: number, z: number, color: Vec3) => ({
    position: [x, 18, z] as Vec3,
    target: [x * 0.3, 0, z * 0.3] as Vec3,
    color,
    intensity: 400,
    range: 70,
    angle: 30,
    penumbra: 0.3,
    shadowMapSize: 1024,
  });
  return {
    kind: 'field',
    camera: { position: [0, 28, 48], target: [0, 0, 0], fovY: 50, near: 0.5, far: 250 },
    clearColor: CLEAR,
    ambient: { color: AMBIENT.color, intensity: 0.15 },
    sun: sun({ intensity: 1.6, shadow: { cascades: 4, mapSize: 2048, maxDistance: 120 } }),
    geometries,
    materials: [GREY],
    count,
    geom,
    material,
    position,
    scale,
    quat,
    animated: true,
    ground: { size: 80, material: { color: [0.55, 0.55, 0.55], roughness: 0.9, metalness: 0 } },
    spots: [spot(25, 25, [1, 0.6, 0.3]), spot(-25, 25, [0.3, 0.6, 1]), spot(25, -25, [0.4, 1, 0.4]), spot(-25, -25, [1, 0.35, 0.8])],
    post: post ? { bloom: { strength: 0.6, threshold: 0.85, radius: 0.5 } } : undefined,
    shadows: true,
    update: (t) => spin(t, quat),
  };
}

function sponza(assets: AssetManifest): GltfScene {
  const a = assets.Sponza;
  // Sponza's root node scales the centimetre data by 0.008 — frame the world-space extent.
  const { min, max } = a.worldBounds ?? a.bounds;
  const c: Vec3 = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  const lenX = max[0] - min[0], lenZ = max[2] - min[2], h = max[1] - min[1];
  const alongX = lenX >= lenZ;
  const len = alongX ? lenX : lenZ;
  const camera: CameraSpec = { position: [0, 0, 0], target: [0, 0, 0], fovY: 60, near: len / 2000, far: len * 1.5 };
  const update = (t: number) => {
    const s = Math.sin((t * Math.PI * 2) / 16) * 0.35 * len;
    const yaw = 0.6 * Math.sin((t * Math.PI * 2) / 10);
    const y = c[1] + 0.15 * h;
    const px = alongX ? c[0] + s : c[0];
    const pz = alongX ? c[2] : c[2] + s;
    const fx = alongX ? Math.cos(yaw) : Math.sin(yaw);
    const fz = alongX ? Math.sin(yaw) : Math.cos(yaw);
    camera.position = [px, y, pz];
    camera.target = [px + fx, y + 0.08, pz + fz];
  };
  update(0);
  return {
    kind: 'gltf-scene',
    url: a.url,
    camera,
    clearColor: [0.35, 0.45, 0.6],
    ambient: { color: [0.7, 0.75, 0.85], intensity: 0.5 },
    sun: sun({ direction: norm([0.2, -1, 0.15]), intensity: 3 }),
    update,
  };
}

function characters(assets: AssetManifest, model: 'Fox' | 'BrainStem', count: number): CharactersScene {
  const a = assets[model];
  const r = rng(8);
  const { min, max } = a.bounds;
  const up = model === 'BrainStem' ? 2 : 1; // BrainStem's mesh data is Z-up; its root node rotates it
  const height = max[up] - min[up];
  const scale = 1.6 / height;
  const footprint = Math.max(...[0, 1, 2].filter((k) => k !== up).map((k) => max[k] - min[k])) * scale;
  const spacing = Math.max(1.4, footprint * 1.1);
  const cols = Math.ceil(Math.sqrt(count * 1.6));
  const rows = Math.ceil(count / cols);
  const position = new Float32Array(count * 3), yaw = new Float32Array(count), phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    position[i * 3] = ((i % cols) - (cols - 1) / 2) * spacing;
    position[i * 3 + 1] = 0;
    position[i * 3 + 2] = (Math.floor(i / cols) - (rows - 1) / 2) * spacing;
    yaw[i] = r.range(-0.6, 0.6);
    phase[i] = r.range(0, 3);
  }
  const width = cols * spacing, depth = rows * spacing;
  const dist = Math.max(width / ASPECT, depth) * 0.95 + 4;
  return {
    kind: 'characters',
    url: a.url,
    count,
    clip: model === 'Fox' ? Math.max(0, a.animations.indexOf('Walk')) : 0,
    scale,
    position,
    yaw,
    phase,
    camera: { position: [0, dist * 0.55, dist * 0.8], target: [0, 0.5, 0], fovY: 50, near: 0.1, far: dist * 4 },
    clearColor: CLEAR,
    ambient: AMBIENT,
    sun: sun(),
    update: () => {},
  };
}

function particles(count: number): ParticlesScene {
  const r = rng(9);
  const initPosition = new Float32Array(count * 4), initVelocity = new Float32Array(count * 4);
  const tmp = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    r.unit(tmp);
    const rad = 15 * Math.cbrt(r.next());
    initPosition.set([tmp[0] * rad, tmp[1] * rad, tmp[2] * rad, 1], i * 4);
    r.unit(tmp);
    const sp = r.range(0.5, 3);
    initVelocity.set([tmp[0] * sp, tmp[1] * sp, tmp[2] * sp, 0], i * 4);
  }
  return {
    kind: 'particles',
    count,
    initPosition,
    initVelocity,
    bounds: 20,
    size: 0.05 * Math.sqrt(1e6 / count),
    sim: { attractorRadius: 8, attractorSpeed: 0.5, strength: 40, damping: 0.995 },
    camera: { position: [0, 0, 55], target: [0, 0, 0], fovY: 50, near: 0.5, far: 200 },
    clearColor: CLEAR,
    ambient: AMBIENT,
    update: () => {},
  };
}

export const needsAssets = (id: ScenarioId) => id === 's7' || id === 's8' || id === 's8b';

export function buildScene(id: ScenarioId, level: number, assets: AssetManifest | null): SceneData {
  const need = () => {
    if (!assets) throw new Error('assets/manifest.json missing — run `npm run fetch-assets`');
    return assets;
  };
  switch (id) {
    case 's0': return startup();
    case 's1': return frustumField(1, level, [GREY], () => 0);
    case 's2': return materialVariety(level);
    case 's3': return instances(level);
    case 's4': return pointLights(level);
    case 's5': return shadowField(level, false);
    case 's6': return shadowField(level, true);
    case 's7': return sponza(need());
    case 's8': return characters(need(), 'Fox', level);
    case 's8b': return characters(need(), 'BrainStem', level);
    case 's9': return particles(level);
  }
}

/**
 * Reference particle integration (one step), which every engine's compute shader must match:
 *   attractor = (cos(t*speed)*R, sin(t*speed*1.3)*R*0.5, sin(t*speed)*R)
 *   d = attractor - p;  v += d * (strength / (dot(d,d) + 1)) * dt;  v *= damping;  p += v * dt
 *   per axis: if |p| > bounds { p = sign(p)*bounds; v = -v*0.8 }
 *   color = mix((0.1,0.3,1.0), (1.0,0.5,0.1), clamp(length(v)/6, 0, 1))
 */
