import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { Engine } from '@babylonjs/core/Engines/engine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Scene } from '@babylonjs/core/scene';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
// Side effect: the scene's default material (used by meshes before a material is assigned).
import '@babylonjs/core/Materials/standardMaterial';
import type { CameraSpec, EngineAdapter, InitOptions, InitReport, LoadReport, SceneData, Variant } from '../../harness/types';
import { deg, srgb3 } from '../common';
import { buildField } from './field';
import { buildInstances } from './instances';
import { buildGltf } from './gltf';
import { buildCharacters } from './characters';
import { buildParticles } from './particles';

// Spec light units → Babylon units. PBR punctual lights use Lambert /π (like three); the
// ambient term doesn't, so it stays unscaled.
export const LIGHT_SCALE = Math.PI;

export interface BabylonCtx {
  engine: AbstractEngine;
  scene: Scene;
  camera: TargetCamera;
  webgpu: boolean;
  sun: DirectionalLight | null;
}

export interface Built {
  path: string;
  notes?: string[];
  /** Runs inside the engine frame, before scene.render(). */
  update(t: number, dt: number): void;
  /** Runs once the scene is ready (freezes, snapshot recording). */
  afterReady?(): void;
}

export function applyCamera(camera: TargetCamera, c: CameraSpec) {
  camera.position.set(...c.position);
  camera.setTarget(new Vector3(...c.target));
}

/** whenReadyAsync never settles when a shader fails to compile — surface the error instead. */
function whenReady(scene: Scene) {
  return new Promise<void>((resolve, reject) => {
    for (const m of scene.materials) m.onError = (_, errors) => reject(new Error(`babylon: material "${m.name}" failed to compile: ${errors.slice(0, 600)}`));
    scene.whenReadyAsync(true).then(resolve, reject);
  });
}

export function createAdapter(): EngineAdapter {
  return new BabylonAdapter();
}

class BabylonAdapter implements EngineAdapter {
  readonly name = 'babylon';
  readonly version = Engine.Version;
  private ctx!: BabylonCtx;
  private built!: Built;

  async init(canvas: HTMLCanvasElement, opts: InitOptions): Promise<InitReport> {
    let engine: AbstractEngine;
    const webgpu = opts.backend === 'webgpu';
    if (webgpu) {
      const e = new WebGPUEngine(canvas, {
        antialias: opts.msaa === 4,
        premultipliedAlpha: false, // opaque canvas, like the other engines
        adaptToDeviceRatio: false,
        powerPreference: 'high-performance',
        audioEngine: false,
        // Request the adapter's limits instead of the spec minimums (e.g. 16 inter-stage variables
        // can't carry 5 shadowed lights' varyings).
        setMaximumLimits: true,
      } as any);
      await e.initAsync();
      engine = e;
    } else {
      engine = new Engine(canvas, opts.msaa === 4, { adaptToDeviceRatio: false, audioEngine: false, powerPreference: 'high-performance' } as any, false);
    }
    engine.setSize(opts.width, opts.height);
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const camera = new TargetCamera('camera', new Vector3(0, 0, 10), scene);
    scene.activeCamera = camera;
    this.ctx = { engine, scene, camera, webgpu, sun: null };
    const msaa = webgpu ? ((engine as any)._mainPassSampleCount ?? 4) : (engine as Engine)._gl?.getContextAttributes()?.antialias ? 4 : 1;
    return { backend: engine.isWebGPU ? 'webgpu' : 'webgl2', msaa };
  }

  async load(data: SceneData, variant: Variant, opt?: string): Promise<LoadReport> {
    const { scene, camera } = this.ctx;
    const c = data.camera;
    applyCamera(camera, c);
    camera.fov = deg(c.fovY);
    camera.minZ = c.near;
    camera.maxZ = c.far;
    // Clear color is written straight to the (sRGB) swapchain, bypassing image processing.
    scene.clearColor = new Color4(...srgb3(data.clearColor), 1);
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1;

    // Flat ambient (PBR: scene.ambientColor × material.ambientColor × albedo), like the other engines'
    // ambient terms — a light would take one of WebGPU's per-stage uniform-buffer slots.
    scene.ambientColor = new Color3(...data.ambient.color).scale(data.ambient.intensity);
    if (data.sun) {
      const s = data.sun;
      const sun = new DirectionalLight('sun', new Vector3(...s.direction), scene);
      sun.diffuse = sun.specular = new Color3(...s.color);
      sun.intensity = s.intensity * LIGHT_SCALE;
      sun.position = new Vector3(-s.direction[0] * 50, -s.direction[1] * 50, -s.direction[2] * 50);
      this.ctx.sun = sun;
    }

    switch (data.kind) {
      case 'field':
        this.built = buildField(this.ctx, data, variant, opt);
        break;
      case 'instances':
        this.built = buildInstances(this.ctx, data);
        break;
      case 'gltf-scene':
        this.built = await buildGltf(this.ctx, data);
        break;
      case 'characters':
        this.built = await buildCharacters(this.ctx, data, variant);
        break;
      case 'particles':
        this.built = await buildParticles(this.ctx, data);
        break;
    }
    for (const m of scene.materials) if (m instanceof PBRMaterial) m.ambientColor = Color3.White();
    await whenReady(scene);
    this.built.afterReady?.();
    return { path: this.built.path, notes: this.built.notes };
  }

  frame(t: number, dt: number) {
    const { engine, scene } = this.ctx;
    engine.beginFrame();
    this.built.update(t, dt);
    scene.render(true, true);
    engine.endFrame();
  }

  counters() {
    const { scene } = this.ctx;
    return { activeMeshes: scene.getActiveMeshes().length };
  }

  async dispose() {
    this.ctx.scene.dispose();
    this.ctx.engine.dispose();
  }
}
