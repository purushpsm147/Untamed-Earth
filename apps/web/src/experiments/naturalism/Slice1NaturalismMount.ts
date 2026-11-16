import * as THREE from 'three';
import {
  ArticulatedChitalRig,
  ExperimentalResourceTracker,
  ReadonlyAnimalAnimState,
  createArticulatedChitalRig,
  createChitalPelageMaterial,
  updateArticulatedChitalRig,
} from './NaturalRiverbankLab';
import { ChitalPrototypeV4 } from './ChitalPrototypeV4';
import type { ChitalSimInput, ChitalGroundingDiagnostic } from './ChitalPrototypeV4';

export interface Slice1Diagnostics {
  readonly mode: 'baseline' | 'naturalistic';
  /** Only the opt-in V4 route selects v4; default V3 and production baseline are unchanged. */
  readonly variant: 'v3' | 'v4';
  readonly maxStanceFootHorizontalErrorMeters: number;
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
  private readonly v4Root = new THREE.Group();
  private readonly v4Rigs: ChitalPrototypeV4[] = [];
  private variant: 'v3' | 'v4' = 'v3';
  private lastV4Sec: number | null = null;
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
    this.v4Root.name = 'Slice1_ExperimentalChitalV4_OptIn';
    this.v4Root.visible = false;
    // V4 is a second visual representation of exactly the same staged herd IDs
    // inside the EXISTING scene/renderer. It never creates another WebGL context.
    for (const st of bindings.herdStates) {
      const v4 = new ChitalPrototypeV4(150 + st.id, st.hasAntlers ? 'stag' : 'hind');
      const sim = this.toV4Input(st);
      v4.update(sim, 0, { getHeightAt: bindings.sampleTerrainHeight }, 0);
      this.v4Rigs.push(v4);
      this.v4Root.add(v4.root);
    }
    bindings.scene.add(this.v4Root);
  }

  private toV4Input(st: ReadonlyAnimalAnimState): ChitalSimInput {
    // V3 deer model points +X; V4 model points +Z. Account for their different
    // local forward axes without changing authoritative world heading.
    const heading = st.heading + Math.PI * 0.5;
    const pose: ChitalSimInput['state'] =
      st.state === 'rest' ? 'idle' : st.state === 'idle' && st.alertLevel > 0.3
      ? 'alert' : st.state;
    return {
      id: st.id, x: st.x, z: st.z, heading, speed: st.speed,
      state: pose, sex: st.hasAntlers ? 'stag' : 'hind', seed: 150 + st.id,
    };
  }

  public setVariant(variant: 'v3' | 'v4'): void {
    this.variant = variant;
    this.groupRoot.visible = false;
    this.v4Root.visible = false;
    this.lastV4Sec = null;
    this.resetFramePacingSamples();
  }

  public setMode(mode: 'baseline' | 'naturalistic'): void {
    this.groupRoot.visible = mode === 'naturalistic' && this.variant === 'v3';
    this.v4Root.visible = mode === 'naturalistic' && this.variant === 'v4';
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

    this.setMode(mode);

    let worstStanceHoofError = 0;
    let worstStanceHorizontalError = 0;
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

    let v4HeroDiag: ChitalGroundingDiagnostic | null = null;
    if (this.variant === 'v4' && mode === 'naturalistic') {
      const dt = this.lastV4Sec === null ? 0 : Math.max(0, Math.min(0.05, timeSec - this.lastV4Sec));
      this.lastV4Sec = timeSec;
      for (let i = 0; i < this.v4Rigs.length; i++) {
        const diag = this.v4Rigs[i].update(
          this.toV4Input(this.bindings.herdStates[i]),
          dt,
          { getHeightAt: this.bindings.sampleTerrainHeight },
          timeSec,
        );
        if (i === 0) v4HeroDiag = diag;
        worstStanceHoofError = Math.max(worstStanceHoofError, diag.maxStanceFootErrorMeters);
        worstStanceHorizontalError = Math.max(worstStanceHorizontalError, diag.maxStanceFootHorizontalErrorMeters);
      }
    }

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
      variant: this.variant,
      preset,
      viewport: { width: size.x, height: size.y },
      activeChitalCount: this.variant === 'v4' ? this.v4Rigs.length : this.rigs.length,
      maxStanceHoofErrorMeters: worstStanceHoofError,
      maxStanceFootHorizontalErrorMeters: worstStanceHorizontalError,
      heroPitchRad: heroDiag.pitchRad,
      heroRollRad: heroDiag.rollRad,
      heroHoofClearancesMeters: this.variant === 'v4' && v4HeroDiag
        ? {
          FL: v4HeroDiag.footHeightsWorld[0] - v4HeroDiag.terrainHeightsWorld[0],
          FR: v4HeroDiag.footHeightsWorld[1] - v4HeroDiag.terrainHeightsWorld[1],
          BL: v4HeroDiag.footHeightsWorld[2] - v4HeroDiag.terrainHeightsWorld[2],
          BR: v4HeroDiag.footHeightsWorld[3] - v4HeroDiag.terrainHeightsWorld[3],
        }
        : heroDiag.perHoofClearanceMeters,
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
    this.bindings.scene.remove(this.groupRoot, this.v4Root);
    for (const v4 of this.v4Rigs) v4.dispose();
    this.v4Rigs.length = 0;
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
