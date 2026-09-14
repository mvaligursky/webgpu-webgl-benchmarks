import { Sprite, SpriteNodeMaterial } from 'three/webgpu';
import { Fn, If, abs, clamp, cos, dot, float, instanceIndex, instancedArray, length, mix, sign, sin, uniform, vec3, vec4 } from 'three/tsl';
import type { ParticlesScene } from '../../harness/types';
import type { Built } from './common';
import type { ThreeCtx } from './index';

export async function buildParticles({ renderer, scene }: ThreeCtx, d: ParticlesScene): Promise<Built> {
  const pos = instancedArray(d.initPosition, 'vec4');
  const vel = instancedArray(d.initVelocity, 'vec4');
  const time = uniform(0), dt = uniform(0);
  const { attractorRadius: R, attractorSpeed: speed, strength, damping } = d.sim;
  const B = d.bounds;

  const step = Fn(() => {
    const p = pos.element(instanceIndex).xyz.toVar();
    const v = vel.element(instanceIndex).xyz.toVar();
    const a = time.mul(speed);
    const toA = vec3(cos(a).mul(R), sin(a.mul(1.3)).mul(R * 0.5), sin(a).mul(R)).sub(p).toVar();
    v.addAssign(toA.mul(float(strength).div(dot(toA, toA).add(1))).mul(dt));
    v.mulAssign(damping);
    p.addAssign(v.mul(dt));
    for (const c of ['x', 'y', 'z'] as const) {
      If(abs(p[c]).greaterThan(B), () => {
        p[c].assign(sign(p[c]).mul(B));
        v[c].assign(v[c].mul(-0.8));
      });
    }
    pos.element(instanceIndex).assign(vec4(p, 1));
    vel.element(instanceIndex).assign(vec4(v, 0));
  })().compute(d.count);
  await renderer.compileComputeAsync(step);

  const mat = new SpriteNodeMaterial();
  mat.positionNode = pos.toAttribute().xyz;
  mat.colorNode = mix(vec3(0.1, 0.3, 1), vec3(1, 0.5, 0.1), clamp(length(vel.toAttribute().xyz).div(6), 0, 1));
  mat.scaleNode = float(d.size);
  mat.transparent = false; // sprites default to blended
  const sprites = new Sprite(mat);
  sprites.count = d.count;
  sprites.frustumCulled = false;
  scene.add(sprites);

  return {
    path: 'TSL compute (instancedArray) + instanced Sprite',
    update(t, delta) {
      time.value = t;
      dt.value = delta;
      renderer.compute(step);
    },
  };
}
