import type * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import type { Ctx } from '../three/common';
import type { FieldFeatures } from '../three/field';

const na = (why: string) => () => {
  throw new Error(`N/A: ${why}`);
};

export function webglFeatures({ scene, camera }: Ctx): FieldFeatures {
  return {
    cascades(sun, s) {
      // CSM brings one shadow-casting DirectionalLight per cascade in place of the sun
      scene.remove(sun, sun.target);
      const csm = new CSM({
        camera,
        parent: scene,
        cascades: s.cascades,
        maxFar: s.maxDistance,
        shadowMapSize: s.mapSize,
        lightDirection: sun.target.position.clone().sub(sun.position).normalize(),
        lightIntensity: sun.intensity,
      });
      for (const l of csm.lights) l.color.copy(sun.color);
      const mats = new Set<THREE.Material>();
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) mats.add((o as THREE.Mesh).material as THREE.Material);
      });
      mats.forEach((m) => csm.setupMaterial(m));
      return () => csm.update();
    },
    clustered: na('no clustered lighting in WebGLRenderer'),
    bundleGroup: na('render bundles are WebGPU-only'),
    post: na('post-processing is benchmarked on WebGPURenderer only'),
  };
}
