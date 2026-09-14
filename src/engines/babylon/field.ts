import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { GetSupportedSimultaneousLights } from '@babylonjs/core/Materials/materialHelper.functions';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { SnapshotRenderingHelper } from '@babylonjs/core/Misc/snapshotRenderingHelper';
import { ScenePerformancePriority, type Scene } from '@babylonjs/core/scene';
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { FieldScene, Geometry, PbrSpec, PointLightsSpec, Variant } from '../../harness/types';
import { deg } from '../common';
import { LIGHT_SCALE, type BabylonCtx, type Built } from './index';

export function toMesh(g: Geometry, scene: Scene, name = g.name) {
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = g.positions;
  vd.normals = g.normals;
  vd.uvs = g.uvs;
  // Babylon's front faces are clockwise (its builders' winding) even with useRightHandedSystem,
  // so the shared CCW triangles would be culled as back faces and the interiors drawn instead.
  const idx = g.indices.slice();
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  vd.indices = idx;
  vd.applyToMesh(m, false);
  return m;
}

export function toMaterial(m: PbrSpec, scene: Scene, name = 'pbr') {
  const mat = new PBRMaterial(name, scene);
  // PBR albedo is linear, like glTF baseColorFactor.
  mat.albedoColor = new Color3(...m.color);
  mat.roughness = m.roughness;
  mat.metallic = m.metalness;
  return mat;
}

/** S1 optimized candidates (`opt`). */
const FAST_PATHS = {
  priority: 'Mesh clone per object, Intermediate priority + frozen active meshes/materials',
  bundles: 'Mesh clone per object, Intermediate priority + WebGPU non-compatibility mode (render bundles)',
  snapshot: 'Mesh clone per object, FAST snapshot rendering (updateMesh per frame)',
  thin: 'One thin-instanced mesh per geometry',
};
type FastPath = keyof typeof FAST_PATHS;
// Measured fastest on both backends (per-mesh paths pay a UBO write per moved mesh per frame).
const DEFAULT_FAST = { webgpu: 'thin', webgl2: 'thin' } satisfies Record<string, FastPath>;

function pickFastPath(ctx: BabylonCtx, opt: string | undefined, notes: string[]): FastPath {
  const want = opt ?? DEFAULT_FAST[ctx.webgpu ? 'webgpu' : 'webgl2'];
  if (!(want in FAST_PATHS)) throw new Error(`babylon: unknown opt "${want}" (${Object.keys(FAST_PATHS).join(', ')})`);
  if (!ctx.webgpu && (want === 'bundles' || want === 'snapshot')) {
    notes.push(`${want} is WebGPU-only; WebGL2 uses ${DEFAULT_FAST.webgl2}`);
    return DEFAULT_FAST.webgl2;
  }
  return want as FastPath;
}

function addPointLights(scene: Scene, pl: PointLightsSpec, clustered: boolean) {
  const lights: PointLight[] = [];
  for (let i = 0; i < pl.count; i++) {
    // Clustered lights belong to the container only (the docs advise not adding them to the scene).
    const l = new PointLight(`point${i}`, Vector3.FromArray(pl.position, i * 3), scene, clustered);
    l.diffuse = l.specular = Color3.FromArray(pl.color, i * 3);
    l.intensity = pl.intensity * LIGHT_SCALE;
    l.range = pl.range;
    lights.push(l);
  }
  if (clustered && !new ClusteredLightContainer('clustered', lights, scene).isSupported) {
    throw new Error('N/A: clustered lighting needs blendable float render targets');
  }
  const p = pl.position;
  return () => {
    for (let i = 0; i < lights.length; i++) lights[i].position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  };
}

function addSpotsAndShadows(ctx: BabylonCtx, d: FieldScene) {
  const gens: ShadowGenerator[] = [];
  d.spots?.forEach((s, i) => {
    const pos = new Vector3(...s.position);
    // Babylon cone angles are full angles; the spec's are half-angles.
    const l = new SpotLight(`spot${i}`, pos, new Vector3(...s.target).subtract(pos).normalize(), deg(2 * s.angle), 2, ctx.scene);
    l.innerAngle = deg(2 * s.angle * (1 - s.penumbra));
    l.diffuse = l.specular = new Color3(...s.color);
    l.intensity = s.intensity * LIGHT_SCALE;
    l.range = s.range;
    if (d.shadows) gens.push(new ShadowGenerator(s.shadowMapSize, l));
  });
  const sh = d.sun?.shadow;
  if (d.shadows && sh && ctx.sun) {
    const csm = new CascadedShadowGenerator(sh.mapSize, ctx.sun);
    csm.numCascades = sh.cascades;
    csm.shadowMaxZ = sh.maxDistance;
    gens.push(csm);
  }
  // The default bias (0.00005) self-shadows every object; 0.01 is the docs' example value.
  for (const g of gens) {
    g.bias = 0.01;
    g.normalBias = 0.02;
  }
  return gens;
}

function addPost(ctx: BabylonCtx, d: FieldScene) {
  const { bloom } = d.post!;
  const p = new DefaultRenderingPipeline('post', true, ctx.scene, [ctx.camera]);
  p.samples = 4;
  p.fxaaEnabled = false;
  p.bloomEnabled = true;
  p.bloomWeight = bloom.strength;
  p.bloomThreshold = bloom.threshold;
  p.bloomKernel = 128 * bloom.radius; // Babylon's default kernel (64) ↔ radius 0.5
  // The clear now lands in the linear HDR target and is tone-mapped with the rest of the frame.
  ctx.scene.clearColor = new Color4(...d.clearColor, 1);
}

function cloneObjects(scene: Scene, d: FieldScene, mats: PBRMaterial[], tuned: boolean) {
  const sources = d.geometries.map((g) => {
    const m = toMesh(g, scene);
    m.setEnabled(false);
    return m;
  });
  const meshes: Mesh[] = new Array(d.count);
  for (let i = 0; i < d.count; i++) {
    // clone() shares the source geometry; each clone is still its own draw.
    const m = sources[d.geom[i]].clone(`m${i}`)!;
    m.setEnabled(true);
    m.material = mats[d.material[i]];
    m.position.set(d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]);
    m.scaling.setAll(d.scale[i]);
    m.rotationQuaternion = Quaternion.FromArray(d.quat, i * 4);
    m.receiveShadows = d.shadows;
    if (tuned) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.doNotSyncBoundingInfo = true;
    }
    meshes[i] = m;
  }
  const q = d.quat;
  return {
    meshes,
    update() {
      for (let i = 0; i < meshes.length; i++) meshes[i].rotationQuaternion!.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
    },
  };
}

function thinObjects(scene: Scene, d: FieldScene, mats: PBRMaterial[]) {
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < d.count; i++) {
    const key = d.geom[i] * mats.length + d.material[i];
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(i);
  }
  const rot = new Quaternion(), scale = new Vector3(), pos = new Vector3(), m = new Matrix();
  const write = (idx: number[], out: Float32Array) => {
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      rot.copyFromFloats(d.quat[i * 4], d.quat[i * 4 + 1], d.quat[i * 4 + 2], d.quat[i * 4 + 3]);
      Matrix.ComposeToRef(scale.setAll(d.scale[i]), rot, pos.fromArray(d.position, i * 3), m);
      m.copyToArray(out, k * 16);
    }
  };
  const parts = [...buckets].map(([key, idx]) => {
    const mesh = toMesh(d.geometries[Math.floor(key / mats.length)], scene, `thin${key}`);
    mesh.material = mats[key % mats.length];
    mesh.receiveShadows = d.shadows;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    const buf = new Float32Array(idx.length * 16);
    write(idx, buf);
    mesh.thinInstanceSetBuffer('matrix', buf, 16, false);
    return { mesh, idx, buf };
  });
  return {
    meshes: parts.map((p) => p.mesh),
    update() {
      for (const p of parts) {
        write(p.idx, p.buf);
        p.mesh.thinInstanceBufferUpdated('matrix');
      }
    },
  };
}

export function buildField(ctx: BabylonCtx, d: FieldScene, variant: Variant, opt?: string): Built {
  const { scene } = ctx;
  const notes: string[] = [];
  const clustered = variant === 'optimized' && !!d.pointLights;
  const fast = variant === 'optimized' && !d.pointLights ? pickFastPath(ctx, opt, notes) : null;
  const tuned = fast === 'priority' || fast === 'bundles';
  if (tuned) {
    // Set before creating meshes, as the docs require.
    scene.performancePriority = ScenePerformancePriority.Intermediate;
    scene.autoClear = true; // Intermediate turns clearing off; the clear color is part of the image
    if (fast === 'bundles') (ctx.engine as WebGPUEngine).compatibilityMode = false;
  }

  const syncLights = d.pointLights ? addPointLights(scene, d.pointLights, clustered) : null;
  const shadowGens = addSpotsAndShadows(ctx, d);
  // On WebGPU each forward light is its own uniform buffer; Babylon silently drops lights past the
  // per-stage limit, which would render a different image — fail instead.
  const lights = scene.lights.length;
  const supported = GetSupportedSimultaneousLights(scene, lights);
  if (supported < lights) {
    const limit = ctx.engine.getCaps().maxUniformBuffersPerShaderStage;
    throw new Error(`babylon: ${lights} forward lights need ${lights} uniform buffers per stage, only ${supported} fit (maxUniformBuffersPerShaderStage ${limit} minus scene/mesh/material/leftover)`);
  }
  const material = (m: PbrSpec, name: string) => {
    const mat = toMaterial(m, scene, name);
    mat.maxSimultaneousLights = Math.max(mat.maxSimultaneousLights, lights);
    // Range-windowed falloff like the other engines' `range`; clustering needs it set on the material, not the lights.
    if (d.pointLights || d.spots) mat.useGLTFLightFalloff = true;
    return mat;
  };
  const mats = d.materials.map((m, i) => material(m, `mat${i}`));
  if (d.ground) {
    const g = CreateGround('ground', { width: d.ground.size, height: d.ground.size }, scene);
    g.material = material(d.ground.material, 'ground');
    g.receiveShadows = d.shadows;
  }
  const objects = fast === 'thin' ? thinObjects(scene, d, mats) : cloneObjects(scene, d, mats, fast !== null);
  for (const g of shadowGens) g.getShadowMap()!.renderList!.push(...objects.meshes);
  if (d.post) addPost(ctx, d);
  const snapshot = fast === 'snapshot' ? new SnapshotRenderingHelper(scene) : null;

  return {
    path: clustered ? 'Mesh clone per object + ClusteredLightContainer' : fast ? FAST_PATHS[fast] : 'Mesh clone per object (scene defaults)',
    notes,
    update() {
      syncLights?.();
      if (!d.animated) return;
      objects.update();
      snapshot?.updateMesh(objects.meshes, false);
    },
    afterReady() {
      if (tuned) {
        scene.freezeMaterials();
        scene.freezeActiveMeshes();
      }
      snapshot?.enableSnapshotRendering();
    },
  };
}
