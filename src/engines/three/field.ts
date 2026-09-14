import * as THREE from 'three';
import type { FieldScene, PointLightsSpec, PostSpec, SunSpec, Variant } from '../../harness/types';
import { deg } from '../common';
import { LIGHT_SCALE, linear, toGeometry, toMaterial, type Built, type Ctx } from './common';

/** Renderer-specific features; an adapter throws `N/A: …` from the ones its renderer lacks. */
export interface FieldFeatures {
  /** Cascaded sun shadows; may return a per-frame update. */
  cascades(sun: THREE.DirectionalLight, shadow: NonNullable<SunSpec['shadow']>): (() => void) | void;
  /** Swap in Forward+ clustered lighting. */
  clustered(): void;
  bundleGroup(): THREE.Group;
  /** Builds the post chain; returns the call that replaces renderer.render. */
  post(p: PostSpec): () => void;
}

/** Fastest measured S1 candidate on every backend; `opt` selects static | bundle | instanced | batched. */
const DEFAULT_FAST = 'instanced';

interface Objects {
  path: string;
  update(): void;
}

export function buildField(ctx: Ctx, sun: THREE.DirectionalLight | null, d: FieldScene, variant: Variant, opt: string | undefined, f: FieldFeatures): Built {
  const { scene } = ctx;
  ctx.renderer.shadowMap.enabled = d.shadows;
  const geos = d.geometries.map(toGeometry);
  const mats = d.materials.map(toMaterial);
  // optimized S4 keeps the meshes and swaps the lighting; optimized S1 swaps the meshes
  const objects = variant === 'optimized' && !d.pointLights ? fastPath(ctx, d, geos, mats, opt ?? DEFAULT_FAST, f) : naive(scene, d, geos, mats);
  const updates: (() => void)[] = d.animated ? [objects.update] : [];
  let path = objects.path;

  if (d.ground) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(d.ground.size, d.ground.size), toMaterial(d.ground.material));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = d.shadows;
    scene.add(g);
  }
  if (d.pointLights) {
    if (variant === 'optimized') {
      f.clustered();
      path += ' + ClusteredLighting';
    }
    updates.push(pointLights(scene, d.pointLights));
  }
  for (const s of d.spots ?? []) {
    const l = new THREE.SpotLight(linear(s.color), s.intensity * LIGHT_SCALE, s.range, deg(s.angle), s.penumbra);
    l.position.fromArray(s.position);
    l.target.position.fromArray(s.target);
    l.castShadow = d.shadows;
    l.shadow.mapSize.setScalar(s.shadowMapSize);
    scene.add(l, l.target);
  }
  // last, so every material already exists (the classic CSM patches materials)
  if (sun && d.sun?.shadow) {
    const u = f.cascades(sun, d.sun.shadow);
    if (u) updates.push(u);
  }
  return {
    path,
    update: () => updates.forEach((u) => u()),
    render: d.post && f.post(d.post),
  };
}

function pointLights(scene: THREE.Scene, pl: PointLightsSpec) {
  const lights = Array.from({ length: pl.count }, (_, i) => {
    const l = new THREE.PointLight(linear(pl.color.subarray(i * 3)), pl.intensity * LIGHT_SCALE, pl.range);
    scene.add(l);
    return l;
  });
  const update = () => lights.forEach((l, i) => l.position.fromArray(pl.position, i * 3));
  update();
  return update;
}

function perObject(parent: THREE.Object3D, d: FieldScene, geos: THREE.BufferGeometry[], mats: THREE.Material[], manual: boolean) {
  const meshes: THREE.Mesh[] = new Array(d.count);
  for (let i = 0; i < d.count; i++) {
    const m = new THREE.Mesh(geos[d.geom[i]], mats[d.material[i]]);
    m.position.fromArray(d.position, i * 3);
    m.scale.setScalar(d.scale[i]);
    m.quaternion.fromArray(d.quat, i * 4);
    m.castShadow = m.receiveShadow = d.shadows;
    if (manual) {
      // parent sits at the origin: write the world matrix ourselves and let the scene-graph pass skip it
      m.matrixAutoUpdate = m.matrixWorldAutoUpdate = false;
      m.matrixWorld.compose(m.position, m.quaternion, m.scale);
    }
    parent.add(m);
    meshes[i] = m;
  }
  return meshes;
}

function naive(scene: THREE.Scene, d: FieldScene, geos: THREE.BufferGeometry[], mats: THREE.Material[]): Objects {
  const meshes = perObject(scene, d, geos, mats, false);
  return {
    path: 'Mesh per object (Object3D defaults)',
    update: () => meshes.forEach((m, i) => m.quaternion.fromArray(d.quat, i * 4)),
  };
}

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const compose = (d: FieldScene, i: number) => _m.compose(_p.fromArray(d.position, i * 3), _q.fromArray(d.quat, i * 4), _s.setScalar(d.scale[i]));

// S1 has a single material, so the batched paths draw everything with mats[0].
function fastPath(ctx: Ctx, d: FieldScene, geos: THREE.BufferGeometry[], mats: THREE.Material[], opt: string, f: FieldFeatures): Objects {
  const { scene } = ctx;
  switch (opt) {
    case 'static':
    case 'bundle': {
      ctx.renderer.sortObjects = false;
      let parent: THREE.Object3D = scene;
      if (opt === 'bundle') scene.add((parent = f.bundleGroup()));
      const meshes = perObject(parent, d, geos, mats, true);
      return {
        path: `${opt === 'bundle' ? 'BundleGroup render bundle, ' : ''}Mesh per object with manual world matrices, sortObjects=false`,
        update: () => meshes.forEach((m, i) => m.matrixWorld.compose(m.position, m.quaternion.fromArray(d.quat, i * 4), m.scale)),
      };
    }
    case 'instanced': {
      const ids = geos.map((): number[] => []);
      for (let i = 0; i < d.count; i++) ids[d.geom[i]].push(i);
      const groups = ids.filter((g) => g.length).map((g) => {
        const im = new THREE.InstancedMesh(geos[d.geom[g[0]]], mats[0], g.length);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        scene.add(im);
        return { im, g };
      });
      const update = () => {
        for (const { im, g } of groups) {
          for (let k = 0; k < g.length; k++) im.setMatrixAt(k, compose(d, g[k]));
          im.instanceMatrix.needsUpdate = true;
        }
      };
      update();
      return { path: 'InstancedMesh per geometry', update };
    }
    case 'batched': {
      const verts = geos.reduce((n, g) => n + g.attributes.position.count, 0);
      const indices = geos.reduce((n, g) => n + g.index!.count, 0);
      const bm = new THREE.BatchedMesh(d.count, verts, indices, mats[0]);
      bm.perObjectFrustumCulled = bm.sortObjects = false;
      const geoIds = geos.map((g) => bm.addGeometry(g));
      for (let i = 0; i < d.count; i++) bm.setMatrixAt(bm.addInstance(geoIds[d.geom[i]]), compose(d, i));
      scene.add(bm);
      return {
        path: 'BatchedMesh',
        update: () => {
          for (let i = 0; i < d.count; i++) bm.setMatrixAt(i, compose(d, i));
        },
      };
    }
    default:
      throw new Error(`three field: unknown optimized path "${opt}" (static, bundle, instanced, batched)`);
  }
}
