import { WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace, Scene, PerspectiveCamera, REVISION } from 'three';
import type { EngineAdapter, InitOptions, InitReport, LoadReport, SceneData, Variant } from '../../harness/types';
import { precompile, setupCommon, type Built } from '../three/common';
import { buildField } from '../three/field';
import { buildInstances } from '../three/instances';
import { buildGltf } from '../three/gltf';
import { buildCharacters } from '../three/characters';
import { webglFeatures } from './field-webgl';

// Classic WebGLRenderer: the mature WebGL2 path most three.js apps still ship. Scenario builders
// are shared with the WebGPU adapter through three's core classes.

export function createAdapter(): EngineAdapter {
  return new ThreeClassicAdapter();
}

class ThreeClassicAdapter implements EngineAdapter {
  readonly name = 'three-classic';
  readonly version = `r${REVISION}`;
  private ctx!: { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera };
  private built!: Built;

  async init(canvas: HTMLCanvasElement, opts: InitOptions): Promise<InitReport> {
    if (opts.backend !== 'webgl2') throw new Error('three-classic only supports webgl2');
    const r = new WebGLRenderer({ canvas, antialias: opts.msaa === 4, alpha: false, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.setSize(opts.width, opts.height, false);
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.outputColorSpace = SRGBColorSpace;
    r.info.autoReset = false;
    this.ctx = { renderer: r, scene: new Scene(), camera: new PerspectiveCamera() };
    return { backend: 'webgl2', msaa: r.getContext().getContextAttributes()?.antialias ? 4 : 1 };
  }

  async load(data: SceneData, variant: Variant, opt?: string): Promise<LoadReport> {
    const ctx = this.ctx;
    const { scene, camera, renderer } = ctx;
    const { sun } = setupCommon(scene, camera, data, renderer.domElement.width / renderer.domElement.height);
    switch (data.kind) {
      case 'field':
        this.built = buildField(ctx, sun, data, variant, opt, webglFeatures(ctx));
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
        throw new Error('N/A: WebGLRenderer has no compute shaders');
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
    return { drawCalls: i.render.calls, triangles: i.render.triangles };
  }

  async dispose() {
    this.ctx.renderer.dispose();
  }
}
