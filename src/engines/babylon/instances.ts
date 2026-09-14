import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { InstancesScene } from '../../harness/types';
import type { BabylonCtx, Built } from './index';
import { toMaterial, toMesh } from './field';

export function buildInstances(ctx: BabylonCtx, d: InstancesScene): Built {
  const mesh = toMesh(d.geometry, ctx.scene);
  mesh.material = toMaterial(d.material, ctx.scene);
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.doNotSyncBoundingInfo = true; // set before the buffer, or it computes bounds over every instance
  mesh.thinInstanceSetBuffer('matrix', d.matrices, 16, false);
  return {
    path: 'Thin instances (dynamic matrix buffer, re-uploaded per frame)',
    update: () => mesh.thinInstanceBufferUpdated('matrix'),
  };
}
