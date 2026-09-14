// Smallest lit PBR cube on the classic WebGLRenderer — used only to measure the shipped bundle size.
import { WebGLRenderer, Scene, PerspectiveCamera, Mesh, BoxGeometry, MeshStandardMaterial, DirectionalLight, AmbientLight, ACESFilmicToneMapping } from 'three';

const canvas = document.querySelector('canvas')!;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = ACESFilmicToneMapping;
const scene = new Scene();
const camera = new PerspectiveCamera(50, 16 / 9, 0.1, 100);
camera.position.set(0, 1.2, 3);
camera.lookAt(0, 0, 0);
const cube = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: 0xcc5522, roughness: 0.4 }));
const sun = new DirectionalLight(0xffffff, 3);
sun.position.set(2, 4, 3);
scene.add(cube, sun, new AmbientLight(0xffffff, 0.5));
renderer.setAnimationLoop((t) => {
  cube.rotation.y = t / 1000;
  renderer.render(scene, camera);
});
