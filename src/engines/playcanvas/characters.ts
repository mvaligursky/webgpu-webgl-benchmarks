import * as pc from 'playcanvas';
import type { CharactersScene, Variant } from '../../harness/types';
import { loadContainer, type Built, type PcCtx } from './index';

export async function buildCharacters({ app }: PcCtx, d: CharactersScene, variant: Variant): Promise<Built> {
  if (variant === 'optimized') throw new Error('N/A: PlayCanvas has no built-in instanced or baked skinning path that keeps per-character clip phases');
  const res = await loadContainer(app, d.url);
  const track = res.animations[d.clip].resource as pc.AnimTrack;
  const layers: pc.AnimComponentLayer[] = [];
  for (let i = 0; i < d.count; i++) {
    const root = new pc.Entity();
    root.setLocalPosition(d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]);
    root.setLocalEulerAngles(0, d.yaw[i] * pc.math.RAD_TO_DEG, 0);
    root.setLocalScale(d.scale, d.scale, d.scale);
    const model = res.instantiateRenderEntity();
    // speed 0: app.update(dt) must not advance the clip, its time is set from t in update()
    model.addComponent('anim', { activate: true, speed: 0 });
    model.anim!.assignAnimation('clip', track);
    const layer = model.anim!.baseLayer!;
    layer.play('clip'); // leave START now, so frame 0 already honours the phase
    layers.push(layer);
    root.addChild(model);
    app.root.addChild(root);
  }
  const duration = track.duration;
  return {
    path: 'instantiateRenderEntity per character + anim component',
    notes: ['clip time = (t + phase) mod duration via AnimComponentLayer.activeStateCurrentTime; anim speed 0'],
    update(t) {
      for (let i = 0; i < layers.length; i++) layers[i].activeStateCurrentTime = (t + d.phase[i]) % duration;
    },
  };
}
