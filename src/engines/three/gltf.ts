import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GltfScene } from '../../harness/types';
import type { Built, Ctx } from './common';

export async function buildGltf({ scene, camera }: Ctx, d: GltfScene): Promise<Built> {
  scene.add((await new GLTFLoader().loadAsync(d.url)).scene);
  const c = d.camera;
  return {
    path: 'GLTFLoader scene graph',
    update() {
      camera.position.fromArray(c.position);
      camera.lookAt(c.target[0], c.target[1], c.target[2]);
    },
  };
}
