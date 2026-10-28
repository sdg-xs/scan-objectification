import { AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { Group } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { disposeAsset } from "./asset-geometry";

/** Owns the preview geometry and releases it with the temporary rendering surface. */
export function showAssetPreview(host: HTMLElement, geometry: Group): () => void {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ antialias: true }); }
  catch (error) { disposeAsset(geometry); throw error; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  host.replaceChildren(renderer.domElement);
  const scene = new Scene(); scene.background = new Color("#eef2f3"); scene.add(geometry, new AmbientLight(0xffffff, 2));
  const light = new DirectionalLight(0xffffff, 3); light.position.set(3, -4, 6); scene.add(light);
  const camera = new PerspectiveCamera(40, 1, 0.001, 10000); camera.up.set(0, 0, 1);
  const bounds = new Box3().setFromObject(geometry), center = bounds.getCenter(new Vector3());
  const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.001);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.copy(center);
  const render = () => renderer.render(scene, camera);
  let fitted = false;
  const resize = () => {
    const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false); camera.aspect = width / height;
    if (!fitted) {
      const fov = 40 * Math.PI / 180;
      const distance = radius / Math.sin(Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * camera.aspect))) * 1.15;
      camera.position.copy(center).add(new Vector3(1, -1.5, 1).normalize().multiplyScalar(distance));
      camera.near = radius / 1000; camera.far = distance + radius * 100; fitted = true;
      orbit.update();
    }
    camera.updateProjectionMatrix(); render();
  };
  orbit.addEventListener("change", render);
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return () => { observer.disconnect(); orbit.dispose(); disposeAsset(geometry); renderer.dispose(); renderer.domElement.remove(); };
}
