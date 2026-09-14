import { BundleGroup, RenderPipeline } from 'three/webgpu';
import { pass, renderOutput } from 'three/tsl';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { FieldFeatures } from './field';
import type { ThreeCtx } from './index';

// WebGPURenderer-only field features, kept out of field.ts so three-classic doesn't bundle them.
export function webgpuFeatures({ renderer, scene, camera }: ThreeCtx): FieldFeatures {
  return {
    cascades(sun, s) {
      sun.castShadow = true;
      sun.shadow.mapSize.setScalar(s.mapSize);
      sun.shadow.shadowNode = new CSMShadowNode(sun, { cascades: s.cascades, maxFar: s.maxDistance });
    },
    clustered() {
      // on the WebGL2 backend it compiles but the point lights render unlit
      if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) throw new Error('N/A: ClusteredLighting needs the WebGPU backend (compute + storage buffers)');
      const lighting = new ClusteredLighting();
      lighting.maxLightsPerCluster = 128; // default 64 drops lights at 512 (hard-edged dark tiles)
      renderer.lighting = lighting;
    },
    bundleGroup() {
      // static bundles skip per-object uniform refresh (frozen transforms); non-static still replays the recording
      const g = new BundleGroup();
      g.static = false;
      return g;
    },
    post({ bloom: b }) {
      const pipeline = new RenderPipeline(renderer);
      const color = pass(scene, camera).getTextureNode('output');
      pipeline.outputColorTransform = false;
      pipeline.outputNode = renderOutput(color.add(bloom(color, b.strength, b.radius, b.threshold)));
      return () => pipeline.render();
    },
  };
}
