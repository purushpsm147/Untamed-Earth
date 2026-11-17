import * as THREE from 'three';

/**
 * Experimental per-instance visibility, independent of ecology and the procedural animal geometry.
 * Keep the union of the camera and directional-light shadow-camera frusta: otherwise animals
 * outside the camera can disappear from shadows cast onto visible terrain.
 */
export type AnimalVisibilityResult = 'camera' | 'shadow' | 'culled';

export class AnimalVisibility {
  private readonly cameraFrustum = new THREE.Frustum();
  private readonly shadowFrustum = new THREE.Frustum();
  private readonly cameraClip = new THREE.Matrix4();
  private readonly shadowClip = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private shadowActive = false;

  /** Refresh after camera motion, Sky.update(), and any shadow-quality change. */
  prepare(camera: THREE.Camera, shadowLight?: THREE.DirectionalLight): void {
    camera.updateMatrixWorld();
    this.cameraClip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.cameraFrustum.setFromProjectionMatrix(this.cameraClip);
    this.shadowActive = !!shadowLight?.castShadow;
    if (shadowLight?.castShadow) {
      // Matches the update Three.js performs when it renders the directional shadow map.
      shadowLight.updateMatrixWorld();
      shadowLight.target.updateMatrixWorld();
      shadowLight.shadow.updateMatrices(shadowLight);
      const c = shadowLight.shadow.camera;
      this.shadowClip.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      this.shadowFrustum.setFromProjectionMatrix(this.shadowClip);
    }
  }

  /**
   * Conservative bounding sphere is provided by the caller and must include the animal's
   * full animated pose and possible flood displacement. No visibility result changes sim state.
   */
  classify(x: number, y: number, z: number, radius: number): AnimalVisibilityResult {
    this.sphere.center.set(x, y, z);
    this.sphere.radius = radius;
    if (this.cameraFrustum.intersectsSphere(this.sphere)) return 'camera';
    if (this.shadowActive && this.shadowFrustum.intersectsSphere(this.sphere)) return 'shadow';
    return 'culled';
  }
}
