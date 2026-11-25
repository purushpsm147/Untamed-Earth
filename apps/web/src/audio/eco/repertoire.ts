/**
 * Which sounds each simulated species may make, and why.
 *
 * Two questions are kept apart:
 *  1. BEHAVIOUR — does the species make this kind of sound in this situation at all? Only entries marked
 *     `documented` are voiced. `unsupported` entries exist so that silence is an explicit, reviewable decision
 *     (e.g. the Indian hare has no known alarm call: its simulated `alarm` events are silent).
 *  2. ACOUSTICS — does our synthesis sound like the real animal? NOTHING here is claimed. Every voice is an original
 *     procedural placeholder (`synthesis: 'procedural-unverified'`) until a human listening review with reference
 *     recordings accepts it (docs/handover/AUDIO_HANDOVER.md, listening protocol).
 *
 * Behaviour notes are qualitative field-guide level descriptions, not measurements. Frequencies and timings in the
 * synthesisers are design guesses, documented in synth.ts, and must not be quoted as species data.
 *
 * Triggers:
 *  - `event:*`  — a real Simulation event (via onAudioEvents). This is the only way an alarm or kill is heard.
 *  - `state:*`  — presentation derived from the animal's *current state* (behaviour family, time of day). The
 *                 simulation does not model vocal behaviour, so these are flagged `tier: 'state-derived'` and can be
 *                 switched off as a group. Their inclusion in production requires director approval.
 */
import type { SpeciesId } from '@untamed/ecology';

export type CallId =
  | 'chital-alarm-bark'
  | 'boar-alarm-snort'
  | 'boar-forage-grunt'
  | 'crow-alarm-caws'
  | 'crow-contact-caw'
  | 'crow-roost-chorus'
  | 'myna-alarm-rasp'
  | 'myna-contact'
  | 'myna-roost-chatter'
  | 'jackal-chorus-howl'
  | 'hare-distress-scream'
  | 'kill-scuffle';

export type Trigger =
  | 'event:alarm'
  | 'event:kill'
  | 'event:kill-prey'
  | 'state:active-day'
  | 'state:roost-twilight'
  | 'state:forage-near'
  | 'state:active-night';

export interface CallProfile {
  readonly id: CallId;
  readonly species: SpeciesId;
  readonly trigger: Trigger;
  readonly tier: 'event' | 'state-derived';
  /** Beyond this listener distance the call is not played (metres). Design value, not a measured detection range. */
  readonly rangeM: number;
  /** PannerNode refDistance: distance at which the call is at its nominal level. */
  readonly refM: number;
  /** Minimum real seconds between two plays of this call by the same animal. */
  readonly cooldownS: number;
  /** 0..1 priority when the voice budget is full (multiplied by proximity). */
  readonly priority: number;
  /** Nominal peak level before distance (linear, relative). */
  readonly level: number;
  readonly evidence: 'documented';
  readonly behaviourBasis: string;
  readonly synthesis: 'procedural-unverified';
}

export interface SilentEntry {
  readonly species: SpeciesId;
  readonly trigger: Trigger;
  readonly evidence: 'unsupported' | 'by-design';
  readonly reason: string;
}

const P = (p: Omit<CallProfile, 'evidence' | 'synthesis'>): CallProfile => ({ ...p, evidence: 'documented', synthesis: 'procedural-unverified' });

export const CALL_PROFILES: readonly CallProfile[] = [
  P({
    id: 'chital-alarm-bark', species: 'chital', trigger: 'event:alarm', tier: 'event', rangeM: 320, refM: 12, cooldownS: 4, priority: 1, level: 0.5,
    behaviourBasis: 'Chital give a loud, sharp alarm bark on detecting a predator, often repeated; widely described in Indian field literature.',
  }),
  P({
    id: 'boar-alarm-snort', species: 'boar', trigger: 'event:alarm', tier: 'event', rangeM: 120, refM: 8, cooldownS: 5, priority: 0.8, level: 0.45,
    behaviourBasis: 'Wild boar give an abrupt explosive snort/grunt when alarmed before running.',
  }),
  P({
    id: 'crow-alarm-caws', species: 'crow', trigger: 'event:alarm', tier: 'event', rangeM: 260, refM: 10, cooldownS: 5, priority: 0.7, level: 0.4,
    behaviourBasis: 'House crows give rapid harsh caws when they detect and mob a predator.',
  }),
  P({
    id: 'myna-alarm-rasp', species: 'myna', trigger: 'event:alarm', tier: 'event', rangeM: 150, refM: 6, cooldownS: 4, priority: 0.6, level: 0.35,
    behaviourBasis: 'Common mynas give harsh rasping alarm calls toward predators.',
  }),
  P({
    id: 'hare-distress-scream', species: 'hare', trigger: 'event:kill-prey', tier: 'event', rangeM: 200, refM: 8, cooldownS: 10, priority: 0.9, level: 0.45,
    behaviourBasis: 'Hares (Lepus spp.) are generally silent but scream loudly when caught; general to the genus, not specific to L. nigricollis.',
  }),
  P({
    id: 'kill-scuffle', species: 'jackal', trigger: 'event:kill', tier: 'event', rangeM: 80, refM: 5, cooldownS: 6, priority: 0.8, level: 0.35,
    behaviourBasis: 'Physical sound of a struggle in vegetation (not a vocalisation).',
  }),
  P({
    id: 'jackal-chorus-howl', species: 'jackal', trigger: 'state:active-night', tier: 'state-derived', rangeM: 1400, refM: 25, cooldownS: 240, priority: 0.7, level: 0.35,
    behaviourBasis: 'Golden jackals howl in group choruses, mostly at dusk and through the night; pair/group mates join in.',
  }),
  P({
    id: 'crow-contact-caw', species: 'crow', trigger: 'state:active-day', tier: 'state-derived', rangeM: 220, refM: 10, cooldownS: 25, priority: 0.35, level: 0.3,
    behaviourBasis: 'House crows caw frequently through the day while active.',
  }),
  P({
    id: 'crow-roost-chorus', species: 'crow', trigger: 'state:roost-twilight', tier: 'state-derived', rangeM: 300, refM: 12, cooldownS: 14, priority: 0.4, level: 0.3,
    behaviourBasis: 'House crows are noisy at communal roosts around dusk and dawn.',
  }),
  P({
    id: 'myna-contact', species: 'myna', trigger: 'state:active-day', tier: 'state-derived', rangeM: 120, refM: 6, cooldownS: 18, priority: 0.3, level: 0.25,
    behaviourBasis: 'Common mynas have a varied repertoire of whistles, gurgles and chatters used through the day.',
  }),
  P({
    id: 'myna-roost-chatter', species: 'myna', trigger: 'state:roost-twilight', tier: 'state-derived', rangeM: 160, refM: 8, cooldownS: 10, priority: 0.35, level: 0.25,
    behaviourBasis: 'Mynas chatter loudly at communal roosts at dusk before settling.',
  }),
  P({
    id: 'boar-forage-grunt', species: 'boar', trigger: 'state:forage-near', tier: 'state-derived', rangeM: 30, refM: 4, cooldownS: 9, priority: 0.25, level: 0.25,
    behaviourBasis: 'Foraging wild boar give soft, low contact grunts; audible only at short range.',
  }),
];

export const SILENT: readonly SilentEntry[] = [
  { species: 'hare', trigger: 'event:alarm', evidence: 'unsupported', reason: 'No known alarm vocalisation; hares rely on crypsis and flight. Simulated hare alarms are silent.' },
  { species: 'jackal', trigger: 'event:alarm', evidence: 'by-design', reason: 'The simulation gives jackals no predators, so they never emit alarm events.' },
  { species: 'chital', trigger: 'event:kill-prey', evidence: 'unsupported', reason: 'No reliable description of a distress call from a chital taken by jackals was found; only the scuffle is heard.' },
  { species: 'boar', trigger: 'event:kill-prey', evidence: 'unsupported', reason: 'Piglet distress squeals exist, but the simulation does not distinguish piglets in kill events reliably enough; scuffle only.' },
  { species: 'crow', trigger: 'event:kill-prey', evidence: 'unsupported', reason: 'Not modelled; scuffle only.' },
  { species: 'myna', trigger: 'event:kill-prey', evidence: 'unsupported', reason: 'Not modelled; scuffle only.' },
  { species: 'chital', trigger: 'state:active-day', evidence: 'by-design', reason: 'No state-derived chital calls: chital vocalise mainly in alarm (event) and rut (not simulated).' },
  { species: 'hare', trigger: 'state:active-night', evidence: 'by-design', reason: 'Hares are silent in normal activity.' },
];

/** Births and non-predation deaths are silent: the event carries no audible behaviour (AUDIO_INTEGRATION.md 3). */
export const SILENT_EVENT_KINDS = ['birth', 'death'] as const;

const BY_TRIGGER = new Map<string, CallProfile>();
for (const p of CALL_PROFILES) BY_TRIGGER.set(`${p.species}:${p.trigger}`, p);

export function profileFor(species: SpeciesId, trigger: Trigger): CallProfile | undefined {
  return BY_TRIGGER.get(`${species}:${trigger}`);
}

export function profileById(id: CallId): CallProfile {
  const p = CALL_PROFILES.find((c) => c.id === id);
  if (!p) throw new Error(`unknown call ${id}`);
  return p;
}
