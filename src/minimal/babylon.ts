// Smallest lit PBR cube on WebGPU — used only to measure the shipped bundle size.
// Documented deep ES6 imports (each carries its own side effects); the 9.8+ `pure` barrel
// with explicit Register*() calls can go smaller still.
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';

const canvas = document.querySelector('canvas')!;
const engine = new WebGPUEngine(canvas, { antialias: true });
await engine.initAsync();
const scene = new Scene(engine);
scene.imageProcessingConfiguration.toneMappingEnabled = true;
scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
const camera = new FreeCamera('camera', new Vector3(0, 1.2, -3), scene);
camera.setTarget(Vector3.Zero());
new HemisphericLight('ambient', new Vector3(0, 1, 0), scene).intensity = 0.5;
new DirectionalLight('sun', new Vector3(-0.5, -1, 0.5), scene).intensity = 3;
const material = new PBRMaterial('pbr', scene);
material.albedoColor = new Color3(0.8, 0.3, 0.1);
material.roughness = 0.4;
material.metallic = 0;
const cube = CreateBox('cube', { size: 1 }, scene);
cube.material = material;
engine.runRenderLoop(() => {
  cube.rotation.y += engine.getDeltaTime() / 1000;
  scene.render();
});
