import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { CharactersScene, Variant } from '../../harness/types';
import type { Built, Ctx } from './common';

export async function buildCharacters({ scene }: Ctx, d: CharactersScene, variant: Variant): Promise<Built> {
  if (variant === 'optimized') {
    throw new Error('N/A: three has no instanced skinning with per-instance animation time (webgpu_skinning_instancing shares one pose across instances)');
  }
  const gltf = await new GLTFLoader().loadAsync(d.url);
  const clip = gltf.animations[d.clip];
  // tracks of unnamed nodes bind by uuid, which clone() changes
  gltf.scene.traverse((o) => {
    o.name ||= o.uuid;
  });
  const mixers: THREE.AnimationMixer[] = [];
  for (let i = 0; i < d.count; i++) {
    const root = new THREE.Group();
    root.position.fromArray(d.position, i * 3);
    root.rotation.y = d.yaw[i];
    root.scale.setScalar(d.scale);
    const model = SkeletonUtils.clone(gltf.scene);
    root.add(model);
    scene.add(root);
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
    mixers.push(mixer);
  }
  return {
    path: 'SkinnedMesh per character (SkeletonUtils.clone + AnimationMixer)',
    update(t) {
      mixers.forEach((m, i) => m.setTime((t + d.phase[i]) % clip.duration));
    },
  };
}
