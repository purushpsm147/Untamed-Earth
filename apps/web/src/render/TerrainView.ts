import * as THREE from 'three';
import { APRON, CHUNKS, CHUNK_SIZE, ChunkMeshData, Valley, buildChunkMesh } from '@untamed/worlds';
import { shared } from './shared';

interface Chunk {
  cx: number;
  cz: number;
  mesh: THREE.Mesh | null;
  res: number;
  pending: number;
  want: number;
  d: number;
}
type Result = ChunkMeshData & { cx: number; cz: number; res: number };

/**
 * Streams terrain chunks around the camera. Geometry is generated off-thread at a
 * distance-dependent resolution; out-of-range chunks are disposed so they cost nothing.
 */
export class TerrainView {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  private readonly chunks = new Map<number, Chunk>();
  private worker: Worker | null = null;
  private inFlight = 0;
  private queue: Chunk[] = [];
  viewDist = 800;
  /** Number of chunks currently holding a mesh / expected in range (for the loading bar). */
  loaded = 0;
  wanted = 1;

  constructor(private readonly valley: Valley) {
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.material.onBeforeCompile = (sh) => {
      sh.uniforms.uDry = shared.uDry;
      sh.uniforms.uWet = shared.uWet;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWp; uniform float uDry; uniform float uWet;
          float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float grassy = vColor.a;
          float dn = tn(vWp.xz * 0.9) * 0.6 + tn(vWp.xz * 4.3) * 0.4;
          float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
          // seasonal curing of grass, driven by simulated soil moisture and biomass
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.53, 0.3) * (lum * 2.2 + 0.15), grassy * uDry * 0.85);
          diffuseColor.rgb *= 0.8 + dn * 0.4;
          diffuseColor.rgb *= 1.0 - uWet * 0.22;
          diffuseColor.a = 1.0;`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, uWet * 0.8);');
    };
    try {
      this.worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), { type: 'module' });
      this.worker.postMessage({ seed: valley.seed, cx: 0, cz: 0, res: 0 });
      this.worker.onmessage = (e: MessageEvent<Result>) => {
        this.inFlight--;
        this.apply(e.data);
        this.pump();
      };
      this.worker.onerror = () => {
        // fall back to synchronous generation on the main thread
        this.worker?.terminate();
        this.worker = null;
        this.inFlight = 0;
      };
    } catch {
      this.worker = null;
    }
  }

  private lodFor(d: number): number {
    return d < 170 ? 48 : d < 380 ? 24 : d < 760 ? 12 : 6;
  }

  private apply(r: Result): void {
    const key = (r.cx + 16) * 64 + (r.cz + 16);
    const c = this.chunks.get(key);
    if (!c) return; // unloaded while in flight
    c.pending = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(r.colors, 4));
    g.setIndex(new THREE.BufferAttribute(r.indices, 1));
    g.computeBoundingSphere();
    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = g;
    } else {
      c.mesh = new THREE.Mesh(g, this.material);
      c.mesh.receiveShadow = true;
      c.mesh.matrixAutoUpdate = false;
      this.group.add(c.mesh);
    }
    c.res = r.res;
  }

  update(cam: THREE.Vector3): void {
    const lo = -APRON;
    const hi = CHUNKS + APRON;
    let wanted = 0;
    let loaded = 0;
    this.queue.length = 0;
    for (let cz = lo; cz < hi; cz++) {
      for (let cx = lo; cx < hi; cx++) {
        const dx = Math.max(cx * CHUNK_SIZE - cam.x, 0, cam.x - (cx + 1) * CHUNK_SIZE);
        const dz = Math.max(cz * CHUNK_SIZE - cam.z, 0, cam.z - (cz + 1) * CHUNK_SIZE);
        const d = Math.hypot(dx, dz);
        const key = (cx + 16) * 64 + (cz + 16);
        let c = this.chunks.get(key);
        if (d > this.viewDist + CHUNK_SIZE) {
          if (c && d > this.viewDist + CHUNK_SIZE * 2.5) {
            if (c.mesh) {
              this.group.remove(c.mesh);
              c.mesh.geometry.dispose();
            }
            this.chunks.delete(key);
          }
          continue;
        }
        wanted++;
        if (!c) this.chunks.set(key, (c = { cx, cz, mesh: null, res: 0, pending: 0, want: 6, d: 0 }));
        if (c.mesh) loaded++;
        // a missing chunk is first filled at the coarsest LOD so the world appears quickly
        const want = c.mesh ? this.lodFor(d) : 6;
        if (c.res !== want && c.pending !== want) {
          c.want = want;
          c.d = c.mesh ? d + 5000 : d; // missing chunks first, then refinements
          this.queue.push(c);
        }
      }
    }
    this.wanted = wanted;
    this.loaded = loaded;
    if (this.queue.length === 0) return;
    this.queue.sort((p, q) => q.d - p.d); // nearest last, so pump() can pop
    this.pump();
  }

  /** Dispatch queued chunk builds. Also called when a result arrives, so loading speed is not tied to frame rate. */
  private pump(): void {
    if (this.worker) {
      while (this.inFlight < 6 && this.queue.length > 0) {
        const c = this.queue.pop()!;
        if (c.pending === c.want) continue;
        c.pending = c.want;
        this.inFlight++;
        this.worker.postMessage({ id: 0, cx: c.cx, cz: c.cz, res: c.want });
      }
    } else if (this.queue.length > 0) {
      // main-thread fallback: one chunk per frame keeps the frame time bounded
      const c = this.queue.pop()!;
      this.apply({ ...buildChunkMesh(this.valley, c.cx, c.cz, c.want), cx: c.cx, cz: c.cz, res: c.want });
    }
  }

  dispose(): void {
    this.worker?.terminate();
    for (const c of this.chunks.values()) c.mesh?.geometry.dispose();
    this.material.dispose();
  }
}
