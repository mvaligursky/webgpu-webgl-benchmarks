import { WebGPURenderer, ACESFilmicToneMapping, SRGBColorSpace, Scene, PerspectiveCamera, REVISION } from 'three/webgpu';
import type { EngineAdapter, InitOptions, InitReport, LoadReport, SceneData, Variant } from '../../harness/types';
import { precompile, setupCommon, type Built } from './common';
import { buildField } from './field';
import { webgpuFeatures } from './field-webgpu';
import { buildInstances } from './instances';
import { buildGltf } from './gltf';
import { buildCharacters } from './characters';
import { buildParticles } from './particles';

export interface ThreeCtx {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}

export function createAdapter(): EngineAdapter {
  return new ThreeAdapter();
}

class ThreeAdapter implements EngineAdapter {
  readonly name = 'three';
  readonly version = `r${REVISION}`;
  private ctx!: ThreeCtx;
  private built!: Built;

  async init(canvas: HTMLCanvasElement, opts: InitOptions): Promise<InitReport> {
    const renderer = new WebGPURenderer({
      canvas,
      antialias: opts.msaa === 4,
      samples: opts.msaa === 4 ? 4 : 0,
      alpha: false,
      forceWebGL: opts.backend === 'webgl2',
      powerPreference: 'high-performance',
    } as any);
    await renderer.init();
    renderer.setPixelRatio(1);
    renderer.setSize(opts.width, opts.height, false);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.info.autoReset = false;
    const backend = (renderer as any).backend;
    const notes: string[] = [];
    if (backend.compatibilityMode) notes.push('WebGPU compatibility mode (MSAA disabled by three)');
    this.ctx = { renderer, scene: new Scene(), camera: new PerspectiveCamera() };
    return { backend: backend.isWebGPUBackend ? 'webgpu' : 'webgl2', msaa: renderer.samples, notes };
  }

  async load(data: SceneData, variant: Variant, opt?: string): Promise<LoadReport> {
    const ctx = this.ctx;
    const { scene, camera, renderer } = ctx;
    const { sun } = setupCommon(scene, camera, data, renderer.domElement.width / renderer.domElement.height);
    switch (data.kind) {
      case 'field':
        this.built = buildField(ctx, sun, data, variant, opt, webgpuFeatures(ctx));
        break;
      case 'instances':
        this.built = buildInstances(ctx, data);
        break;
      case 'gltf-scene':
        this.built = await buildGltf(ctx, data);
        break;
      case 'characters':
        this.built = await buildCharacters(ctx, data, variant);
        break;
      case 'particles':
        this.built = await buildParticles(ctx, data);
        break;
    }
    const compileNotes = await precompile(renderer, scene, camera);
    return { path: this.built.path, notes: [...(this.built.notes ?? []), ...compileNotes] };
  }

  frame(t: number, dt: number) {
    const { renderer, scene, camera } = this.ctx;
    renderer.info.reset();
    this.built.update(t, dt);
    if (this.built.render) this.built.render();
    else renderer.render(scene, camera);
  }

  counters() {
    const i = this.ctx.renderer.info;
    return { drawCalls: i.render.drawCalls, triangles: i.render.triangles, computeCalls: i.compute.frameCalls };
  }

  async dispose() {
    this.ctx.renderer.dispose();
  }
}
