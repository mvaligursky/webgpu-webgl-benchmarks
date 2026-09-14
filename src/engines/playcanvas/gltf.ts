import type { GltfScene } from '../../harness/types';
import { loadContainer, type Built, type PcCtx } from './index';

export async function buildGltf({ app, camera }: PcCtx, d: GltfScene): Promise<Built> {
  const res = await loadContainer(app, d.url);
  app.root.addChild(res.instantiateRenderEntity());
  const c = d.camera; // rewritten by scene.update(t)
  return {
    path: 'container asset + instantiateRenderEntity',
    update() {
      camera.setPosition(...c.position);
      camera.lookAt(...c.target);
    },
  };
}
