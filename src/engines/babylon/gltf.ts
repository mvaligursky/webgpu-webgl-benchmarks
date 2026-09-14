import '@babylonjs/loaders/glTF/2.0';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { GltfScene } from '../../harness/types';
import { applyCamera, type BabylonCtx, type Built } from './index';

export async function buildGltf(ctx: BabylonCtx, d: GltfScene): Promise<Built> {
  const container = await LoadAssetContainerAsync(d.url, ctx.scene);
  container.addAllToScene();
  return {
    path: 'glTF 2.0 loader → AssetContainer',
    update: () => applyCamera(ctx.camera, d.camera),
  };
}
