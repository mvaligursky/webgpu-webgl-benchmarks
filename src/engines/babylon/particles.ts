import { ComputeShader } from '@babylonjs/core/Compute/computeShader';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader';
import { StorageBuffer } from '@babylonjs/core/Buffers/storageBuffer';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { ParticlesScene } from '../../harness/types';
import type { BabylonCtx, Built } from './index';

const WORKGROUP = 256;
const PARAMS = ['t', 'dt', 'count', 'bounds', 'radius', 'speed', 'strength', 'damping'] as const;

const SIM = /* wgsl */ `
struct Params { ${PARAMS.map((p) => `${p}: f32`).join(', ')} };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= u32(params.count)) { return; }
  let a = params.t * params.speed;
  let attractor = vec3f(cos(a) * params.radius, sin(a * 1.3) * params.radius * 0.5, sin(a) * params.radius);
  var p = pos[i].xyz;
  var v = vel[i].xyz;
  let d = attractor - p;
  v += d * (params.strength / (dot(d, d) + 1.0)) * params.dt;
  v *= params.damping;
  p += v * params.dt;
  let out = abs(p) > vec3f(params.bounds);
  p = select(p, sign(p) * params.bounds, out);
  v = select(v, -v * 0.8, out);
  pos[i] = vec4f(p, 1.0);
  vel[i] = vec4f(v, 0.0);
}`;

const VERTEX = /* wgsl */ `
attribute position: vec3f;
attribute ppos: vec4f;
attribute pvel: vec4f;
uniform view: mat4x4f;
uniform viewProjection: mat4x4f;
uniform size: f32;
varying vColor: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let right = vec3f(uniforms.view[0].x, uniforms.view[1].x, uniforms.view[2].x);
  let up = vec3f(uniforms.view[0].y, uniforms.view[1].y, uniforms.view[2].y);
  let corner = (right * vertexInputs.position.x + up * vertexInputs.position.y) * uniforms.size;
  vertexOutputs.position = uniforms.viewProjection * vec4f(vertexInputs.ppos.xyz + corner, 1.0);
  let k = clamp(length(vertexInputs.pvel.xyz) / 6.0, 0.0, 1.0);
  vertexOutputs.vColor = mix(vec3f(0.1, 0.3, 1.0), vec3f(1.0, 0.5, 0.1), k);
}`;

// Unlit: bypasses image processing, so encode linear → sRGB here.
const FRAGMENT = /* wgsl */ `
varying vColor: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let c = fragmentInputs.vColor;
  fragmentOutputs.color = vec4f(select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308)), 1.0);
}`;

export async function buildParticles(ctx: BabylonCtx, d: ParticlesScene): Promise<Built> {
  if (!ctx.webgpu) throw new Error('N/A: compute shaders require WebGPU');
  const engine = ctx.engine as WebGPUEngine;
  const n = d.count;
  // Vertex usage lets the render pass read the sim state as instanced attributes.
  const flags = Constants.BUFFER_CREATIONFLAG_VERTEX | Constants.BUFFER_CREATIONFLAG_WRITE;
  const pos = new StorageBuffer(engine, n * 16, flags, 'particlePos');
  const vel = new StorageBuffer(engine, n * 16, flags, 'particleVel');
  pos.update(d.initPosition);
  vel.update(d.initVelocity);

  const params = new UniformBuffer(engine, undefined, false, 'particleParams');
  for (const p of PARAMS) params.addUniform(p, 1);
  params.create();
  const { attractorRadius: radius, attractorSpeed: speed, strength, damping } = d.sim;
  for (const [k, v] of Object.entries({ count: n, bounds: d.bounds, radius, speed, strength, damping })) params.updateFloat(k, v);

  const sim = new ComputeShader('particleSim', engine, { computeSource: SIM }, {
    bindingsMapping: { params: { group: 0, binding: 0 }, pos: { group: 0, binding: 1 }, vel: { group: 0, binding: 2 } },
  });
  sim.setUniformBuffer('params', params);
  sim.setStorageBuffer('pos', pos);
  sim.setStorageBuffer('vel', vel);
  // Every frame must integrate exactly one step, so don't let the first dispatch be skipped.
  while (!sim.isReady()) await new Promise((r) => setTimeout(r, 5));

  const quad = new Mesh('particles', ctx.scene);
  const vd = new VertexData();
  vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
  vd.indices = [0, 1, 2, 0, 2, 3];
  vd.applyToMesh(quad);
  quad.setVerticesBuffer(new VertexBuffer(engine, pos.getBuffer(), 'ppos', false, false, 4, true, 0, 4));
  quad.setVerticesBuffer(new VertexBuffer(engine, vel.getBuffer(), 'pvel', false, false, 4, true, 0, 4));
  quad.forcedInstanceCount = n;
  quad.alwaysSelectAsActiveMesh = true;
  const mat = new ShaderMaterial('particles', ctx.scene, { vertexSource: VERTEX, fragmentSource: FRAGMENT }, {
    attributes: ['position', 'ppos', 'pvel'],
    uniforms: ['view', 'viewProjection', 'size'],
    shaderLanguage: ShaderLanguage.WGSL,
  });
  mat.setFloat('size', d.size);
  mat.backFaceCulling = false;
  quad.material = mat;

  const groups = Math.ceil(n / WORKGROUP);
  return {
    path: 'ComputeShader (WGSL) + StorageBuffers bound as instanced vertex buffers, ShaderMaterial quads',
    update(t, dt) {
      params.updateFloat('t', t);
      params.updateFloat('dt', dt);
      params.update();
      sim.dispatch(groups);
    },
  };
}
