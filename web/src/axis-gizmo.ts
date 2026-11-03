import type { Camera, WebGLRenderer } from "three";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";

/** Camera-relative world axes, drawn after the scene and outside capture renders. */
export function createAxisGizmo(camera: Camera, renderer: WebGLRenderer) {
  const helper = new ViewHelper(camera, renderer.domElement);
  helper.location.top = 12;
  helper.location.right = 12;
  helper.setLabels("X", "Y", "Z");
  return {
    render(): void {
      const autoClear = renderer.autoClear;
      const clippingPlanes = renderer.clippingPlanes;
      renderer.autoClear = false;
      renderer.clippingPlanes = [];
      try { helper.render(renderer); }
      finally {
        renderer.autoClear = autoClear;
        renderer.clippingPlanes = clippingPlanes;
      }
    },
    dispose(): void { helper.dispose(); },
  };
}
