export type CallTriggerSource = 'SIMULATED_DEMO' | 'ECOLOGY_EVENT';

export type SpeciesCallId = 'chital' | 'crow' | 'myna' | 'jackal';

export interface SpatialCallParams {
  readonly species: SpeciesCallId;
  readonly source: CallTriggerSource;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly startTimeOffset?: number;
}

/**
 * Encodes an AudioBuffer into a standard 44.1kHz 16-bit Stereo PCM .WAV Blob
 * for immediate downloading and human listening review.
 */
export function encodeAudioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const dataByteLength = numSamples * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(arrayBuffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  const left = buffer.getChannelData(0);
  const right = numChannels > 1 ? buffer.getChannelData(1) : left;
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const sL = Math.max(-1, Math.min(1, left[i]));
    const sR = Math.max(-1, Math.min(1, right[i]));
    view.setInt16(offset, sL < 0 ? sL * 0x8000 : sL * 0x7fff, true);
    offset += 2;
    if (numChannels > 1) {
      view.setInt16(offset, sR < 0 ? sR * 0x8000 : sR * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Synthesizes a 3D spatial animal call on any BaseAudioContext (live AudioContext or OfflineAudioContext)
 * using dual-formant vocal tract filtering to reduce raw oscillator synthetic harshness.
 */
export function scheduleSpatialAnimalCall(
  ctx: BaseAudioContext,
  destination: AudioNode,
  params: SpatialCallParams
): void {
  const t0 = ctx.currentTime + (params.startTimeOffset ?? 0);
  const dist = Math.hypot(params.position.x, params.position.y, params.position.z);
  const distGain = 1.0 / (1.0 + 0.045 * dist + 0.0015 * dist * dist);
  const panValue = Math.max(-0.95, Math.min(0.95, params.position.x / Math.max(4.0, dist)));

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(panValue, t0);

  // Air absorption lowpass filter with distance
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = 'lowpass';
  airFilter.frequency.setValueAtTime(Math.max(900, 9500 * Math.exp(-dist / 45)), t0);

  const outGain = ctx.createGain();
  outGain.gain.setValueAtTime(distGain, t0);

  airFilter.connect(panner);
  panner.connect(outGain);
  outGain.connect(destination);

  if (params.species === 'chital') {
    // Axis axis startled alarm bark: sharp glottal pulse + breath burst through 950Hz & 2150Hz formants
    const osc = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    osc.type = 'sawtooth';
    subOsc.type = 'triangle';

    osc.frequency.setValueAtTime(640, t0);
    osc.frequency.exponentialRampToValueAtTime(980, t0 + 0.035);
    osc.frequency.exponentialRampToValueAtTime(490, t0 + 0.19);

    subOsc.frequency.setValueAtTime(320, t0);
    subOsc.frequency.exponentialRampToValueAtTime(490, t0 + 0.035);
    subOsc.frequency.exponentialRampToValueAtTime(245, t0 + 0.19);

    const formant1 = ctx.createBiquadFilter();
    formant1.type = 'bandpass';
    formant1.frequency.setValueAtTime(960, t0);
    formant1.Q.setValueAtTime(3.2, t0);

    const formant2 = ctx.createBiquadFilter();
    formant2.type = 'bandpass';
    formant2.frequency.setValueAtTime(2150, t0);
    formant2.Q.setValueAtTime(4.0, t0);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.55, t0 + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.21);

    osc.connect(formant1);
    osc.connect(formant2);
    subOsc.connect(formant1);
    formant1.connect(env);
    formant2.connect(env);
    env.connect(airFilter);

    osc.start(t0);
    subOsc.start(t0);
    osc.stop(t0 + 0.23);
    subOsc.stop(t0 + 0.23);
  } else if (params.species === 'crow') {
    // Indian House Crow (Corvus splendens): two harsh FM-rough nasal caws
    for (let i = 0; i < 2; i++) {
      const start = t0 + i * 0.34;
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();

      carrier.type = 'sawtooth';
      carrier.frequency.setValueAtTime(1180, start);
      carrier.frequency.linearRampToValueAtTime(1320, start + 0.04);
      carrier.frequency.exponentialRampToValueAtTime(860, start + 0.22);

      mod.type = 'square';
      mod.frequency.setValueAtTime(78, start);
      modGain.gain.setValueAtTime(190, start);

      const nasalFormant = ctx.createBiquadFilter();
      nasalFormant.type = 'bandpass';
      nasalFormant.frequency.setValueAtTime(1450, start);
      nasalFormant.Q.setValueAtTime(2.6, start);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.32, start + 0.018);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(nasalFormant);
      nasalFormant.connect(env);
      env.connect(airFilter);

      mod.start(start);
      carrier.start(start);
      mod.stop(start + 0.25);
      carrier.stop(start + 0.25);
    }
  } else if (params.species === 'myna') {
    // Common Myna (Acridotheres tristis): 3-syllable whistle + warble phrase
    const syllables = [
      { dt: 0.0, f0: 1750, f1: 2450, dur: 0.13 },
      { dt: 0.16, f0: 2300, f1: 1620, dur: 0.15 },
      { dt: 0.35, f0: 1950, f1: 2780, dur: 0.18 },
    ];
    for (const s of syllables) {
      const st = t0 + s.dt;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(s.f0, st);
      osc.frequency.exponentialRampToValueAtTime(s.f1, st + s.dur);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, st);
      env.gain.linearRampToValueAtTime(0.28, st + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, st + s.dur);

      osc.connect(env);
      env.connect(airFilter);
      osc.start(st);
      osc.stop(st + s.dur + 0.02);
    }
  } else if (params.species === 'jackal') {
    // Golden Jackal (Canis aureus): long rising-wavering dusk wail
    const osc = ctx.createOscillator();
    const vibrato = ctx.createOscillator();
    const vibGain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(390, t0);
    osc.frequency.exponentialRampToValueAtTime(780, t0 + 0.65);
    osc.frequency.exponentialRampToValueAtTime(710, t0 + 1.35);
    osc.frequency.exponentialRampToValueAtTime(420, t0 + 1.95);

    vibrato.frequency.setValueAtTime(6.2, t0);
    vibGain.gain.setValueAtTime(0.0, t0);
    vibGain.gain.linearRampToValueAtTime(24.0, t0 + 0.7);

    const throatFilter = ctx.createBiquadFilter();
    throatFilter.type = 'lowpass';
    throatFilter.frequency.setValueAtTime(1400, t0);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.34, t0 + 0.35);
    env.gain.setValueAtTime(0.3, t0 + 1.25);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.0);

    vibrato.connect(vibGain);
    vibGain.connect(osc.frequency);
    osc.connect(throatFilter);
    throatFilter.connect(env);
    env.connect(airFilter);

    vibrato.start(t0);
    osc.start(t0);
    vibrato.stop(t0 + 2.05);
    osc.stop(t0 + 2.05);
  }
}

/**
 * Renders the complete 48-second 6-scene audition reel deterministically via OfflineAudioContext
 * and returns a downloadable 44.1 kHz 16-bit stereo .WAV Blob.
 */
export async function renderCompleteAuditionReelWav(): Promise<Blob> {
  const sampleRate = 44100;
  const durationSec = 48;
  const offline = new OfflineAudioContext(2, sampleRate * durationSec, sampleRate);

  // Shared deterministic PRNG noise buffer (4 seconds looped)
  const noiseLen = sampleRate * 4;
  const noiseBuf = offline.createBuffer(2, noiseLen, sampleRate);
  let seed = 0x5f3759df;
  const nextRand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 0xffffffff) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const data = noiseBuf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < noiseLen; i++) {
      const white = nextRand();
      // Kellet pinking filter approximation
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
    }
  }

  // 1. River layer (0s - 48s, with distance sweep during 08s - 16s)
  const riverSrc = offline.createBufferSource();
  riverSrc.buffer = noiseBuf;
  riverSrc.loop = true;
  const riverLp = offline.createBiquadFilter();
  riverLp.type = 'lowpass';
  const riverGain = offline.createGain();

  // Scene 1 (0-8s): 8m distance -> Scene 2 (8-16s): sweep 3m -> 95m -> 12m
  riverLp.frequency.setValueAtTime(3200, 0);
  riverGain.gain.setValueAtTime(0.32, 0);
  riverLp.frequency.linearRampToValueAtTime(4100, 9.0);
  riverGain.gain.linearRampToValueAtTime(0.48, 9.0);
  riverLp.frequency.exponentialRampToValueAtTime(380, 13.5);
  riverGain.gain.linearRampToValueAtTime(0.06, 13.5);
  riverLp.frequency.exponentialRampToValueAtTime(2400, 16.0);
  riverGain.gain.linearRampToValueAtTime(0.22, 16.0);

  riverSrc.connect(riverLp);
  riverLp.connect(riverGain);
  riverGain.connect(offline.destination);
  riverSrc.start(0);

  // 2. Wind & Canopy Rustle (peaks during Scene 3: 16s - 24s)
  const windSrc = offline.createBufferSource();
  windSrc.buffer = noiseBuf;
  windSrc.loop = true;
  const windBp = offline.createBiquadFilter();
  windBp.type = 'bandpass';
  windBp.frequency.setValueAtTime(520, 0);
  windBp.Q.setValueAtTime(1.8, 0);
  const windGain = offline.createGain();
  windGain.gain.setValueAtTime(0.06, 0);
  windGain.gain.setValueAtTime(0.06, 15.5);
  windGain.gain.linearRampToValueAtTime(0.38, 18.0);
  windBp.frequency.linearRampToValueAtTime(890, 19.5);
  windBp.frequency.linearRampToValueAtTime(460, 22.0);
  windGain.gain.linearRampToValueAtTime(0.08, 24.5);

  windSrc.connect(windBp);
  windBp.connect(windGain);
  windGain.connect(offline.destination);
  windSrc.start(0);

  // 3. Dusk Insects (Scene 4: 24s - 32s)
  const cricketCarrier = offline.createOscillator();
  const cricketAm = offline.createOscillator();
  const cricketAmGain = offline.createGain();
  const cricketEnv = offline.createGain();
  cricketCarrier.type = 'sine';
  cricketCarrier.frequency.setValueAtTime(4380, 23.5);
  cricketAm.type = 'square';
  cricketAm.frequency.setValueAtTime(28, 23.5);
  cricketAmGain.gain.setValueAtTime(0.08, 23.5);
  cricketEnv.gain.setValueAtTime(0.0001, 23.5);
  cricketEnv.gain.linearRampToValueAtTime(0.14, 25.0);
  cricketEnv.gain.setValueAtTime(0.14, 31.0);
  cricketEnv.gain.linearRampToValueAtTime(0.02, 33.0);

  cricketAm.connect(cricketAmGain);
  cricketAmGain.connect(cricketEnv.gain);
  cricketCarrier.connect(cricketEnv);
  cricketEnv.connect(offline.destination);
  cricketCarrier.start(23.5);
  cricketAm.start(23.5);
  cricketCarrier.stop(34.0);
  cricketAm.stop(34.0);

  // 4. Rain Transitioning into Storm (Scene 5: 32s - 40s)
  const rainSrc = offline.createBufferSource();
  rainSrc.buffer = noiseBuf;
  rainSrc.loop = true;
  const rainHp = offline.createBiquadFilter();
  rainHp.type = 'highpass';
  rainHp.frequency.setValueAtTime(1400, 31.5);
  const rainGain = offline.createGain();
  rainGain.gain.setValueAtTime(0.0001, 31.5);
  rainGain.gain.linearRampToValueAtTime(0.22, 33.5);
  rainGain.gain.linearRampToValueAtTime(0.45, 36.5);
  rainGain.gain.linearRampToValueAtTime(0.04, 40.5);
  rainSrc.connect(rainHp);
  rainHp.connect(rainGain);
  rainGain.connect(offline.destination);
  rainSrc.start(31.5);
  rainSrc.stop(41.0);

  // Rolling thunder strike at 36.2s
  const thunderSrc = offline.createBufferSource();
  thunderSrc.buffer = noiseBuf;
  thunderSrc.loop = true;
  const thunderLp = offline.createBiquadFilter();
  thunderLp.type = 'lowpass';
  thunderLp.frequency.setValueAtTime(165, 36.0);
  thunderLp.frequency.exponentialRampToValueAtTime(55, 39.8);
  const thunderGain = offline.createGain();
  thunderGain.gain.setValueAtTime(0.0001, 36.0);
  thunderGain.gain.linearRampToValueAtTime(0.85, 36.25);
  thunderGain.gain.exponentialRampToValueAtTime(0.0001, 40.0);
  thunderSrc.connect(thunderLp);
  thunderLp.connect(thunderGain);
  thunderGain.connect(offline.destination);
  thunderSrc.start(36.0);
  thunderSrc.stop(40.2);

  // 5. Spatial Animal Calls (Scene 6: 40s - 48s)
  scheduleSpatialAnimalCall(offline, offline.destination, {
    species: 'chital',
    source: 'SIMULATED_DEMO',
    position: { x: -14, y: 0, z: -8 },
    startTimeOffset: 40.4,
  });
  scheduleSpatialAnimalCall(offline, offline.destination, {
    species: 'crow',
    source: 'SIMULATED_DEMO',
    position: { x: 9, y: 6, z: -11 },
    startTimeOffset: 41.8,
  });
  scheduleSpatialAnimalCall(offline, offline.destination, {
    species: 'myna',
    source: 'SIMULATED_DEMO',
    position: { x: -6, y: 4, z: -5 },
    startTimeOffset: 43.3,
  });
  scheduleSpatialAnimalCall(offline, offline.destination, {
    species: 'jackal',
    source: 'SIMULATED_DEMO',
    position: { x: 28, y: 2, z: -35 },
    startTimeOffset: 45.0,
  });

  const renderedBuffer = await offline.startRendering();
  return encodeAudioBufferToWavBlob(renderedBuffer);
}
