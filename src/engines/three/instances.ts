import * as THREE from 'three';
import type { InstancesScene } from '../../harness/types';
import { toGeometry, toMaterial, type Built, type Ctx } from './common';

export function buildInstances({ scene }: Ctx, d: InstancesScene): Built {
  // count 0 skips allocating + identity-filling a buffer that the scene's own array replaces
  const mesh = new THREE.InstancedMesh(toGeometry(d.geometry), toMaterial(d.material), 0);
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(d.matrices, 16).setUsage(THREE.DynamicDrawUsage);
  mesh.count = d.count;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    path: 'InstancedMesh sharing the scene matrix array (DynamicDrawUsage)',
    update() {
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
