// Smallest lit PBR cube on WebGPU — used only to measure the shipped bundle size.
import {
  createGraphicsDevice, AppBase, AppOptions, RenderComponentSystem, CameraComponentSystem, LightComponentSystem,
  Entity, StandardMaterial, Color, DEVICETYPE_WEBGPU, TONEMAP_ACES2,
} from 'playcanvas';

const canvas = document.querySelector('canvas')!;
const device = await createGraphicsDevice(canvas, { deviceTypes: [DEVICETYPE_WEBGPU] });
const options = new AppOptions();
options.graphicsDevice = device;
options.componentSystems = [RenderComponentSystem, CameraComponentSystem, LightComponentSystem];
const app = new AppBase(canvas);
app.init(options);

const camera = new Entity();
camera.addComponent('camera', { clearColor: new Color(0.1, 0.1, 0.1), toneMapping: TONEMAP_ACES2 });
camera.setPosition(0, 1.2, 3);
camera.lookAt(0, 0, 0);
const sun = new Entity();
sun.addComponent('light', { type: 'directional' });
sun.setEulerAngles(45, 30, 0);
const material = new StandardMaterial();
material.diffuse = new Color(0.8, 0.3, 0.1);
material.update();
const cube = new Entity();
cube.addComponent('render', { type: 'box', material });
app.root.addChild(camera);
app.root.addChild(sun);
app.root.addChild(cube);
app.on('update', (dt: number) => cube.rotate(0, 30 * dt, 0));
app.start();
