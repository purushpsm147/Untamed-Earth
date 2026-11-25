/**
 * Anatomy studio for the riverbank chital — EXPERIMENT, `/?slice=studio&pose=stand|walk|trot|gallop|graze|lie|alert&view=side|front|three|rear&stag=1&clay=1`.
 *
 * One animal on flat ground under neutral light with the same geometry, material and rig as the slice, for side /
 * front / three-quarter review of silhouette, proportions and joints (VISUAL_V4_ACCEPTANCE.md criterion 2).
 * `clay=1` replaces the coat with flat grey so shape is judged without the pattern. No simulation involved.
 */
import * as THREE from 'three';
import { buildChitalGeometry } from './chitalGeometry';
import { createBoneTexture, createChitalMaterials, writeBoneRow } from './chitalMaterial';
import { BONE_COUNT, Family, newRigState, solveRig } from './chitalRig';

export function startChitalStudio(canvas: HTMLCanvasElement, params: URLSearchParams): { frame: (dt: number) => void; dispose: () => void } {
  for (const id of ['start', 'menu', 'hud', 'loading']) document.getElementById(id)?.classList.add('hidden');
  const pose = params.get('pose') ?? 'stand';
  const view = params.get('view') ?? 'side';
  const stag = params.get('stag') === '1';
  const clay = params.get('clay') === '1';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.62, 0.66, 0.7);
  const cam = new THREE.PerspectiveCamera(24, (canvas.clientWidth || 1280) / (canvas.clientHeight || 720), 0.1, 100);
  const dist = 5.2;
  const dirs: Record<string, [number, number]> = { side: [1, 0], front: [0, 1], three: [0.72, 0.69], rear: [0, -1], left: [-1, 0] };
  const [dx, dz] = dirs[view] ?? dirs.side!;
  cam.position.set(dx * dist, 0.75, dz * dist);
  cam.lookAt(0, 0.55, 0);
  scene.add(new THREE.HemisphereLight(0xdfe8f0, 0x6b5a45, 1.4));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(3, 6, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
  sun.shadow.camera.right = sun.shadow.camera.top = 2;
  sun.shadow.radius = 3;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // 10 cm grid on the ground for scale
  const grid = new THREE.GridHelper(4, 40, 0x5a5248, 0x6f675b);
  grid.position.y = 0.002;
  scene.add(grid);
  const bt = createBoneTexture(1);
  const mats = createChitalMaterials(bt.texture, 0);
  if (clay) {
    const prev = mats.coat.onBeforeCompile;
    mats.coat.onBeforeCompile = (sh, r) => {
      prev.call(mats.coat, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('diffuseColor.rgb *= pelage(vBind, normalize(vBindN), vRegion, coatRough);', 'pelage(vBind, normalize(vBindN), vRegion, coatRough); diffuseColor.rgb *= vec3(0.55); coatRough = 0.7;');
    };
    mats.coat.customProgramCacheKey = () => 'chital-clay';
    mats.coat.sheen = 0;
  }
  const geo = buildChitalGeometry({ antlers: stag, detail: 1 });
  const mesh = new THREE.InstancedMesh(geo, mats.coat, 1);
  mesh.customDepthMaterial = mats.depth;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.setMatrixAt(0, new THREE.Matrix4());
  scene.add(mesh);
  const st = newRigState();
  const bones = new Float32Array(BONE_COUNT * 12);
  const speeds: Record<string, number> = { walk: 1.3, trot: 3.5, gallop: 9 };
  const fam: Record<string, Family> = { graze: 'graze', lie: 'rest', alert: 'idle', stand: 'idle' };
  let t = 0;
  let x = 0;
  const frame = (dt: number): void => {
    t += dt;
    const speed = speeds[pose] ?? 0;
    x += speed * dt;
    // the animal walks on the spot visually: the rig sees motion, the instance stays at the origin
    if (pose === 'bind') {
      for (let b = 0; b < BONE_COUNT; b++) bones.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], b * 12);
    } else solveRig(st, { x: x * 0, z: 0, heading: Math.PI / 2, speed, family: speed > 0 ? 'wander' : fam[pose] ?? 'idle', fear: pose === 'alert' ? 0.8 : 0, scale: 1, dt, time: t, seed: 3 }, () => 0, bones);
    writeBoneRow(bt, 0, bones);
    bt.texture.needsUpdate = true;
    renderer.render(scene, cam);
  };
  (window as unknown as { __studio: unknown }).__studio = { frame };
  return {
    frame,
    dispose(): void {
      mats.dispose();
      geo.dispose();
      mesh.dispose();
      bt.texture.dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      grid.dispose();
      renderer.dispose();
    },
  };
}
