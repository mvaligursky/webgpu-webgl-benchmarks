import * as pc from 'playcanvas';
import type { FieldScene, Geometry, PbrSpec, PointLightsSpec, PostSpec, SpotSpec, Variant, Vec3 } from '../../harness/types';
import { color, downTo, lightColor, LIGHT_SCALE, PUNCTUAL_SCALE, SHADOW_BIAS, type Built, type PcCtx } from './index';

const DEFAULT_OPT = 'instanced';
// PlayCanvas bloom adds an unthresholded sum of blur levels, so the spec's thresholded strength is scaled down.
const BLOOM_SCALE = 0.02;

export function toMesh(device: pc.GraphicsDevice, g: Geometry) {
  const m = new pc.Mesh(device);
  m.setPositions(g.positions);
  m.setNormals(g.normals);
  m.setUvs(0, g.uvs);
  m.setIndices(g.indices);
  m.update(pc.PRIMITIVE_TRIANGLES);
  return m;
}

export function toMaterial(m: PbrSpec) {
  const mat = new pc.StandardMaterial();
  mat.diffuse = color(m.color);
  mat.useMetalness = true;
  mat.metalness = m.metalness;
  mat.gloss = 1 - m.roughness;
  mat.update();
  return mat;
}

interface Objects {
  path: string;
  update(): void;
}
type ObjectPath = (ctx: PcCtx, d: FieldScene, meshes: pc.Mesh[], mats: pc.Material[]) => Objects;

function addEntities({ app }: PcCtx, d: FieldScene, meshes: pc.Mesh[], mats: pc.Material[], batchGroupId = -1) {
  const entities: pc.Entity[] = new Array(d.count);
  for (let i = 0; i < d.count; i++) {
    const e = new pc.Entity();
    e.addComponent('render', {
      meshInstances: [new pc.MeshInstance(meshes[d.geom[i]], mats[d.material[i]])],
      castShadows: d.shadows,
      receiveShadows: d.shadows,
      batchGroupId,
    });
    e.setLocalPosition(d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]);
    e.setLocalScale(d.scale[i], d.scale[i], d.scale[i]);
    e.setLocalRotation(d.quat[i * 4], d.quat[i * 4 + 1], d.quat[i * 4 + 2], d.quat[i * 4 + 3]);
    app.root.addChild(e);
    entities[i] = e;
  }
  const q = d.quat;
  return () => {
    if (!d.animated) return;
    for (let i = 0; i < entities.length; i++) entities[i].setLocalRotation(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
  };
}

/** Column-major TRS (uniform scale) of object i into out[o..o+15] — the Mat4.data layout. */
function compose(out: Float32Array, o: number, i: number, p: Float32Array, s: Float32Array, q: Float32Array) {
  const x = q[i * 4], y = q[i * 4 + 1], z = q[i * 4 + 2], w = q[i * 4 + 3], sc = s[i];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[o] = (1 - (yy + zz)) * sc;
  out[o + 1] = (xy + wz) * sc;
  out[o + 2] = (xz - wy) * sc;
  out[o + 3] = 0;
  out[o + 4] = (xy - wz) * sc;
  out[o + 5] = (1 - (xx + zz)) * sc;
  out[o + 6] = (yz + wx) * sc;
  out[o + 7] = 0;
  out[o + 8] = (xz + wy) * sc;
  out[o + 9] = (yz - wx) * sc;
  out[o + 10] = (1 - (xx + yy)) * sc;
  out[o + 11] = 0;
  out[o + 12] = p[i * 3];
  out[o + 13] = p[i * 3 + 1];
  out[o + 14] = p[i * 3 + 2];
  out[o + 15] = 1;
}

const instanced: ObjectPath = ({ app, device }, d, meshes, mats) => {
  const nm = mats.length;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < d.count; i++) {
    const k = d.geom[i] * nm + d.material[i];
    let ids = buckets.get(k);
    if (!ids) buckets.set(k, (ids = []));
    ids.push(i);
  }
  const format = pc.VertexFormat.getDefaultInstancingFormat(device);
  const groups = [...buckets].map(([k, ids]) => {
    const data = new Float32Array(ids.length * 16);
    const vb = new pc.VertexBuffer(device, format, ids.length, { usage: pc.BUFFER_DYNAMIC, data });
    const mi = new pc.MeshInstance(meshes[Math.floor(k / nm)], mats[k % nm]);
    mi.setInstancing(vb);
    const e = new pc.Entity();
    e.addComponent('render', { meshInstances: [mi], castShadows: d.shadows, receiveShadows: d.shadows });
    app.root.addChild(e);
    return { ids, data, vb };
  });
  const write = () => {
    for (const { ids, data, vb } of groups) {
      for (let j = 0; j < ids.length; j++) compose(data, j * 16, ids[j], d.position, d.scale, d.quat);
      vb.setData(data);
    }
  };
  write();
  return {
    path: 'hardware instancing per geometry (matrices uploaded per frame)',
    update() {
      if (d.animated) write();
    },
  };
};

const PATHS: Record<string, ObjectPath> = {
  entity: (ctx, d, meshes, mats) => ({ path: 'Entity + render component per object', update: addEntities(ctx, d, meshes, mats) }),
  batch: (ctx, d, meshes, mats) => {
    const group = ctx.app.batcher.addGroup('field', true, Number.POSITIVE_INFINITY);
    const update = addEntities(ctx, d, meshes, mats, group.id);
    ctx.app.batcher.generate();
    return { path: 'dynamic BatchManager group (≤1024 objects per draw)', update };
  },
  instanced,
};

function addPointLights(app: pc.AppBase, l: PointLightsSpec, clustered: boolean, notes: string[]) {
  app.scene.clusteredLightingEnabled = clustered;
  if (clustered) {
    app.scene.lighting.maxLights = Math.max(app.scene.lighting.maxLights, l.count); // default 255 drops the rest
    notes.push(`clustered lighting (engine default), lighting.maxLights = ${app.scene.lighting.maxLights}`);
  } else {
    notes.push('clustered lighting disabled (PlayCanvas default is clustered) to get a forward path comparable to the other engines');
  }
  const k = l.intensity * LIGHT_SCALE * PUNCTUAL_SCALE;
  const lights: pc.Entity[] = [];
  for (let i = 0; i < l.count; i++) {
    const e = new pc.Entity();
    e.addComponent('light', {
      type: 'omni',
      ...lightColor([l.color[i * 3], l.color[i * 3 + 1], l.color[i * 3 + 2]], k),
      range: l.range,
      falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED,
      castShadows: false,
    });
    app.root.addChild(e);
    lights.push(e);
  }
  const p = l.position;
  return () => {
    for (let i = 0; i < lights.length; i++) lights[i].setPosition(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  };
}

function addSpots(app: pc.AppBase, spots: SpotSpec[]) {
  // Clustered spot shadows share one atlas: size it so each spot gets its shadowMapSize.
  app.scene.lighting.shadowAtlasResolution = Math.ceil(Math.sqrt(spots.length)) * Math.max(...spots.map((s) => s.shadowMapSize));
  for (const s of spots) {
    const dx = s.target[0] - s.position[0], dy = s.target[1] - s.position[1], dz = s.target[2] - s.position[2];
    const len = Math.hypot(dx, dy, dz);
    const e = new pc.Entity();
    e.addComponent('light', {
      type: 'spot',
      ...lightColor(s.color, s.intensity * LIGHT_SCALE * PUNCTUAL_SCALE),
      range: s.range,
      falloffMode: pc.LIGHTFALLOFF_INVERSESQUARED,
      outerConeAngle: s.angle,
      innerConeAngle: s.angle * (1 - s.penumbra),
      castShadows: true,
      shadowResolution: s.shadowMapSize,
      ...SHADOW_BIAS,
    });
    e.setPosition(...s.position);
    e.setRotation(downTo([dx / len, dy / len, dz / len]));
    app.root.addChild(e);
  }
}

function addPost({ app, camera }: PcCtx, p: PostSpec, clear: Vec3, notes: string[]) {
  const cam = camera.camera!;
  cam.clearColor = new pc.Color(clear[0], clear[1], clear[2]); // the clear value lands raw in the linear HDR target
  const frame = new pc.CameraFrame(app, cam);
  frame.rendering.samples = 4;
  frame.rendering.toneMapping = pc.TONEMAP_ACES2;
  frame.bloom.intensity = p.bloom.strength * BLOOM_SCALE;
  frame.bloom.blurLevel = Math.max(1, Math.round(p.bloom.radius * 10));
  frame.update();
  notes.push(`CameraFrame: 4× MSAA HDR target, bloom intensity ${frame.bloom.intensity} (no threshold in PlayCanvas), blurLevel ${frame.bloom.blurLevel}, ACES2; no FXAA`);
}

export function buildField(ctx: PcCtx, d: FieldScene, variant: Variant, opt?: string): Built {
  const { app, device } = ctx;
  const notes: string[] = [];
  const meshes = d.geometries.map((g) => toMesh(device, g));
  const mats = d.materials.map(toMaterial);
  // S4's optimized variant is its lighting path; elsewhere `optimized` picks an object path.
  const name = variant === 'optimized' && !d.pointLights ? opt ?? DEFAULT_OPT : 'entity';
  const make = PATHS[name];
  if (!make) throw new Error(`playcanvas field: unknown optimized path "${name}" (${Object.keys(PATHS).join(', ')})`);
  const objects = make(ctx, d, meshes, mats);
  let path = objects.path;

  if (d.ground) {
    const g = new pc.Entity('ground');
    g.addComponent('render', { type: 'plane', material: toMaterial(d.ground.material), castShadows: false, receiveShadows: d.shadows });
    g.setLocalScale(d.ground.size, 1, d.ground.size);
    app.root.addChild(g);
  }
  let updateLights: (() => void) | undefined;
  if (d.pointLights) {
    const clustered = variant === 'optimized';
    updateLights = addPointLights(app, d.pointLights, clustered, notes);
    path += clustered ? ', clustered lighting' : ', forward lighting';
  }
  if (d.spots) addSpots(app, d.spots);
  if (d.post) addPost(ctx, d.post, d.clearColor, notes);

  return {
    path,
    notes,
    update() {
      objects.update();
      updateLights?.();
    },
  };
}
