import * as THREE from 'three';
import {
  ArticulatedChitalRig,
  ExperimentalResourceTracker,
  ReadonlyAnimalAnimState,
  createArticulatedChitalRig,
  createChitalPelageMaterial,
  updateArticulatedChitalRig,
} from './NaturalRiverbankLab';

export interface Slice1Diagnostics {
  readonly mode: 'baseline' | 'naturalistic';
  readonly preset: 'riverbank_vista' | 'chital_closeup';
  readonly viewport: { width: number; height: number };
  readonly activeChitalCount: number;
  readonly maxStanceHoofErrorMeters: number;
  readonly heroPitchRad: number;
  readonly heroRollRad: number;
  readonly heroHoofClearancesMeters: Record<'FL' | 'FR' | 'BL' | 'BR', number>;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly framePacingMs: {
    readonly sampleCount: number;
    readonly mean: number;
    readonly min: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly max: number;
  };
}

export interface Slice1HerdBindings {
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGLRenderer;
  readonly sampleTerrainHeight: (x: number, z: number) => number;
  readonly herdStates: readonly ReadonlyAnimalAnimState[];
}

export class Slice1NaturalismController {
  private tracker = new ExperimentalResourceTracker();
  private pelageMat: THREE.MeshStandardMaterial;
  private rigs: ArticulatedChitalRig[] = [];
  private groupRoot = new THREE.Group();
  private frameDeltasMs: number[] = [];
  private lastFrameTimestamp = 0;

  constructor(private readonly bindings: Slice1HerdBindings) {
    this.groupRoot.name = 'Slice1_NaturalisticChitalHerd_v3';
    this.pelageMat = createChitalPelageMaterial(this.tracker);

    for (const st of bindings.herdStates) {
      const rig = createArticulatedChitalRig(this.tracker, this.pelageMat, st.hasAntlers);
      updateArticulatedChitalRig(rig, st, 0, bindings.sampleTerrainHeight);
      this.rigs.push(rig);
      this.groupRoot.add(rig.root);
    }

    bindings.scene.add(this.groupRoot);
  }

  public setMode(mode: 'baseline' | 'naturalistic'): void {
    this.groupRoot.visible = mode === 'naturalistic';
  }

  public resetFramePacingSamples(): void {
    this.frameDeltasMs.length = 0;
    this.lastFrameTimestamp = 0;
  }

  public update(
    timeSec: number,
    mode: 'baseline' | 'naturalistic',
    preset: 'riverbank_vista' | 'chital_closeup'
  ): Slice1Diagnostics {
    const now = performance.now();
    if (this.lastFrameTimestamp > 0) {
      const dt = now - this.lastFrameTimestamp;
      if (dt > 0 && dt < 1000) {
        this.frameDeltasMs.push(dt);
        if (this.frameDeltasMs.length > 600) {
          this.frameDeltasMs.shift();
        }
      }
    }
    this.lastFrameTimestamp = now;

    this.groupRoot.visible = mode === 'naturalistic';

    let worstStanceHoofError = 0;
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i];
      const st = this.bindings.herdStates[i];
      updateArticulatedChitalRig(rig, st, timeSec, this.bindings.sampleTerrainHeight);
      worstStanceHoofError = Math.max(
        worstStanceHoofError,
        rig.lastGroundingDiagnostics.maxStanceHoofErrorMeters
      );
    }

    const heroDiag = this.rigs[0]?.lastGroundingDiagnostics ?? {
      pitchRad: 0,
      rollRad: 0,
      maxStanceHoofErrorMeters: 0,
      perHoofClearanceMeters: { FL: 0, FR: 0, BL: 0, BR: 0 },
    };

    const sorted = [...this.frameDeltasMs].sort((a, b) => a - b);
    const pct = (p: number) =>
      sorted.length === 0
        ? 0
        : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const mean =
      sorted.length === 0 ? 0 : sorted.reduce((acc, v) => acc + v, 0) / sorted.length;

    const size = this.bindings.renderer.getSize(new THREE.Vector2());
    const diagnostics: Slice1Diagnostics = {
      mode,
      preset,
      viewport: { width: size.x, height: size.y },
      activeChitalCount: this.rigs.length,
      maxStanceHoofErrorMeters: worstStanceHoofError,
      heroPitchRad: heroDiag.pitchRad,
      heroRollRad: heroDiag.rollRad,
      heroHoofClearancesMeters: heroDiag.perHoofClearanceMeters,
      drawCalls: this.bindings.renderer.info.render.calls,
      triangles: this.bindings.renderer.info.render.triangles,
      framePacingMs: {
        sampleCount: sorted.length,
        mean: Number(mean.toFixed(3)),
        min: Number((sorted[0] ?? 0).toFixed(3)),
        p50: Number(pct(0.5).toFixed(3)),
        p95: Number(pct(0.95).toFixed(3)),
        p99: Number(pct(0.99).toFixed(3)),
        max: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
      },
    };

    (window as any).__SLICE1_DIAGNOSTICS__ = diagnostics;
    return diagnostics;
  }

  public dispose(): void {
    this.bindings.scene.remove(this.groupRoot);
    this.tracker.disposeAll();
    this.rigs.length = 0;
  }
}


declare global {
  interface Window {
    __SLICE1_DIAGNOSTICS__?: Slice1Diagnostics;
    __SLICE1_CONTROLLER__?: Slice1NaturalismController;
  }
}
