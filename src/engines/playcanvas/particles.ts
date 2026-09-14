import * as pc from 'playcanvas';
import type { ParticlesScene } from '../../harness/types';
import type { Built, PcCtx } from './index';

const SIM = /* wgsl */ `
uniform count: u32;
uniform t: f32;
uniform dt: f32;
uniform bounds: f32;
uniform attractorRadius: f32;
uniform attractorSpeed: f32;
uniform strength: f32;
uniform damping: f32;

var<storage, read_write> positions: array<vec4f>;
var<storage, read_write> velocities: array<vec4f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= uniform.count) { return; }
  let a = uniform.t * uniform.attractorSpeed;
  let r = uniform.attractorRadius;
  let attractor = vec3f(cos(a) * r, sin(a * 1.3) * r * 0.5, sin(a) * r);
  var p = positions[i].xyz;
  var v = velocities[i].xyz;
  let d = attractor - p;
  v += d * (uniform.strength / (dot(d, d) + 1.0)) * uniform.dt;
  v *= uniform.damping;
  p += v * uniform.dt;
  let out = abs(p) > vec3f(uniform.bounds);
  p = select(p, sign(p) * uniform.bounds, out);
  v = select(v, -v * 0.8, out);
  positions[i] = vec4f(p, 1.0);
  velocities[i] = vec4f(v, 0.0);
}
`;

const VS = /* wgsl */ `
uniform matrix_viewProjection: mat4x4f;
uniform matrix_view: mat4x4f;
uniform halfSize: f32;

var<storage, read> positions: array<vec4f>;
var<storage, read> velocities: array<vec4f>;

varying color: vec3f;

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let corner = vec2f(f32(input.vertexIndex & 1u), f32(input.vertexIndex >> 1u)) * 2.0 - 1.0;
  let view = uniform.matrix_view;
  let right = vec3f(view[0][0], view[1][0], view[2][0]);
  let up = vec3f(view[0][1], view[1][1], view[2][1]);
  let p = positions[input.instanceIndex].xyz + (corner.x * right + corner.y * up) * uniform.halfSize;
  var output: VertexOutput;
  output.position = uniform.matrix_viewProjection * vec4f(p, 1.0);
  let speed = length(velocities[input.instanceIndex].xyz);
  output.color = mix(vec3f(0.1, 0.3, 1.0), vec3f(1.0, 0.5, 0.1), clamp(speed / 6.0, 0.0, 1.0));
  return output;
}
`;

// Same camera tonemap + gamma as the lit materials.
const FS = /* wgsl */ `
#include "tonemappingPS"
#include "gammaPS"

varying color: vec3f;

@fragment
fn fragmentMain(input: FragmentInput) -> FragmentOutput {
  var output: FragmentOutput;
  output.color = vec4f(gammaCorrectOutput(toneMap(input.color)), 1.0);
  return output;
}
`;

export function buildParticles({ app, device }: PcCtx, d: ParticlesScene): Built {
  if (!device.supportsCompute) throw new Error('N/A: PlayCanvas compute shaders require WebGPU');
  const positions = new pc.StorageBuffer(device, d.count * 16, pc.BUFFERUSAGE_COPY_DST);
  const velocities = new pc.StorageBuffer(device, d.count * 16, pc.BUFFERUSAGE_COPY_DST);
  positions.write(0, d.initPosition);
  velocities.write(0, d.initVelocity);

  const shader = new pc.Shader(device, { name: 'particle-sim', shaderLanguage: pc.SHADERLANGUAGE_WGSL, cshader: SIM });
  const compute = new pc.Compute(device, shader, 'particle-sim');
  compute.setParameter('positions', positions);
  compute.setParameter('velocities', velocities);
  compute.setParameter('count', d.count);
  compute.setParameter('bounds', d.bounds);
  for (const [k, v] of Object.entries(d.sim)) compute.setParameter(k, v);
  compute.setupDispatch(Math.ceil(d.count / 64));

  const material = new pc.ShaderMaterial({ uniqueName: 'particle-quad', vertexWGSL: VS, fragmentWGSL: FS });
  material.setParameter('positions', positions);
  material.setParameter('velocities', velocities);
  material.setParameter('halfSize', d.size / 2);
  material.update();
  // One quad, instanced per particle without vertex attributes.
  const mesh = new pc.Mesh(device);
  mesh.setIndices([0, 1, 2, 2, 1, 3]);
  mesh.update();
  const mi = new pc.MeshInstance(mesh, material);
  mi.setInstancing(true); // culling off
  mi.instancingCount = d.count;
  const e = new pc.Entity('particles');
  e.addComponent('render', { meshInstances: [mi], castShadows: false });
  app.root.addChild(e);

  return {
    path: 'Compute (WGSL) + ShaderMaterial reading storage buffers, attributeless instanced quads',
    update(t, dt) {
      compute.setParameter('t', t);
      compute.setParameter('dt', dt);
      device.computeDispatch([compute], 'particle-sim');
    },
  };
}
