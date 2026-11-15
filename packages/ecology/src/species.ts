/** Real days of life history represented by one game day (365-day year compressed to a 48-day calendar). */
export const LIFE_COMPRESSION = 365 / 48;

export type SpeciesId = 'chital' | 'boar' | 'jackal' | 'hare' | 'crow' | 'myna';
export type Activity = 'diurnal' | 'crepuscular' | 'nocturnal';

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  sci: string;
  /** Adult body mass, kg. */
  mass: number;
  /** Adult head-and-body length, m (used for camera framing). */
  length: number;
  walk: number;
  run: number;
  /** Seconds of flat-out sprint before exhaustion. */
  sprintS: number;
  vision: number;
  hearing: number;
  /** Carrion detection radius (olfaction / soaring sight), m. */
  smell: number;
  activity: Activity;
  /** Real-world life-history values; converted with LIFE_COMPRESSION. */
  lifespanY: number;
  maturityY: number;
  gestationD: number;
  weanD: number;
  intervalD: number;
  litter: [number, number];
  /** Seasons (0 winter .. 3 post-monsoon) in which conception occurs; null = year-round. */
  breedSeasons: number[] | null;
  /** Daily food requirement, kg. */
  intake: number;
  /** Hours of foraging needed to meet `intake` when food is abundant. */
  feedHours: number;
  /** Fraction of water needs met by moist food. */
  foodWater: number;
  diet: { veg: number; invert: number; fauna: number; carrion: number };
  prey: SpeciesId[];
  predators: SpeciesId[];
  /** Adults stand their ground against listed predators (only juveniles flee). */
  adultFearless: boolean;
  fleeDist: number;
  group: number;
  /** Only the dominant female of each group breeds. */
  pairBreeding?: boolean;
  homeRange: number;
  flies: boolean;
  habitat: { forest: number; meadow: number; wetland: number; settlement: number; dump: number };
  initial: number;
  /** Background mortality per game day from causes not modelled individually (raptors, snakes, disease). */
  juvHazard: number;
  adultHazard: number;
  playable: boolean;
  /** Species-level natural history (general knowledge, not derived from this simulation). */
  note: string;
  /** How the model groups this species; shown in the Social Lens. */
  groupNoun: string;
}

/**
 * Parameters are approximate field values for South Asian populations
 * (see docs/SPECIES.md for sources and simplifications).
 */
export const SPECIES: SpeciesDef[] = [
  {
    id: 'chital', name: 'Spotted deer (chital)', sci: 'Axis axis', mass: 60, length: 1.5, walk: 1.3, run: 12.5, sprintS: 70,
    vision: 95, hearing: 65, smell: 0, activity: 'crepuscular', lifespanY: 11, maturityY: 1.3, gestationD: 230, weanD: 150,
    intervalD: 330, litter: [1, 1], breedSeasons: null, intake: 2.2, feedHours: 7, foodWater: 0.35,
    diet: { veg: 1, invert: 0, fauna: 0, carrion: 0 }, prey: [], predators: ['jackal'], adultFearless: false, fleeDist: 38,
    group: 10, homeRange: 230, flies: false, habitat: { forest: 0.5, meadow: 1, wetland: 0.5, settlement: 0.25, dump: 0 },
    initial: 52, juvHazard: 0.006, adultHazard: 0.0012, playable: true,
    note: 'Chital live in fluid herds that merge and split; an alarm bark from one animal puts the rest on alert.', groupNoun: 'herd',
  },
  {
    id: 'boar', name: 'Wild boar', sci: 'Sus scrofa cristatus', mass: 80, length: 1.35, walk: 1.2, run: 9.5, sprintS: 45,
    vision: 45, hearing: 70, smell: 130, activity: 'nocturnal', lifespanY: 9, maturityY: 0.9, gestationD: 115, weanD: 100,
    intervalD: 300, litter: [3, 6], breedSeasons: null, intake: 3, feedHours: 8, foodWater: 0.35,
    diet: { veg: 0.7, invert: 0.5, fauna: 0.08, carrion: 0.5 }, prey: [], predators: ['jackal'], adultFearless: true, fleeDist: 25,
    group: 6, homeRange: 300, flies: false, habitat: { forest: 1, meadow: 0.4, wetland: 0.8, settlement: 0.3, dump: 0.3 },
    initial: 20, juvHazard: 0.016, adultHazard: 0.0018, playable: false,
    note: 'Wild boar sows and their young form sounders; adult males are often solitary. They root in soil for tubers and invertebrates.', groupNoun: 'sounder',
  },
  {
    id: 'jackal', name: 'Golden jackal', sci: 'Canis aureus indicus', mass: 9, length: 0.85, walk: 1.7, run: 11.5, sprintS: 110,
    vision: 110, hearing: 95, smell: 230, activity: 'crepuscular', lifespanY: 8, maturityY: 0.95, gestationD: 63, weanD: 75,
    intervalD: 360, litter: [2, 5], breedSeasons: [0], intake: 0.75, feedHours: 11, foodWater: 0.3,
    diet: { veg: 0.12, invert: 0.3, fauna: 0.9, carrion: 1 }, prey: ['hare', 'chital', 'boar'], predators: [], adultFearless: true, fleeDist: 0,
    group: 2, pairBreeding: true, homeRange: 480, flies: false, habitat: { forest: 0.5, meadow: 0.8, wetland: 0.3, settlement: 0.9, dump: 0.9 },
    initial: 6, juvHazard: 0.026, adultHazard: 0.0025, playable: false,
    note: 'Golden jackals usually live as a mated pair with their young; older offspring sometimes stay on as helpers.', groupNoun: 'family',
  },
  {
    id: 'hare', name: 'Indian hare', sci: 'Lepus nigricollis', mass: 2.3, length: 0.5, walk: 1.5, run: 12, sprintS: 28,
    vision: 60, hearing: 75, smell: 0, activity: 'nocturnal', lifespanY: 4.5, maturityY: 0.55, gestationD: 42, weanD: 25,
    intervalD: 95, litter: [1, 4], breedSeasons: null, intake: 0.2, feedHours: 6, foodWater: 0.9,
    diet: { veg: 1, invert: 0, fauna: 0, carrion: 0 }, prey: [], predators: ['jackal'], adultFearless: false, fleeDist: 30,
    group: 0, homeRange: 130, flies: false, habitat: { forest: 0.3, meadow: 1, wetland: 0.2, settlement: 0.6, dump: 0.1 },
    initial: 64, juvHazard: 0.02, adultHazard: 0.004, playable: false,
    note: 'Indian hares are largely solitary and rest by day in a shallow form in the grass.', groupNoun: 'loose neighbourhood',
  },
  {
    id: 'crow', name: 'House crow', sci: 'Corvus splendens', mass: 0.3, length: 0.42, walk: 0.7, run: 10, sprintS: 600,
    vision: 220, hearing: 80, smell: 320, activity: 'diurnal', lifespanY: 7, maturityY: 1.6, gestationD: 30, weanD: 35,
    intervalD: 340, litter: [1, 3], breedSeasons: [1, 2], intake: 0.06, feedHours: 6, foodWater: 0.3,
    diet: { veg: 0.3, invert: 0.7, fauna: 0.5, carrion: 1 }, prey: [], predators: ['jackal'], adultFearless: false, fleeDist: 14,
    group: 8, homeRange: 420, flies: true, habitat: { forest: 0.2, meadow: 0.4, wetland: 0.3, settlement: 1, dump: 1 },
    initial: 30, juvHazard: 0.012, adultHazard: 0.0035, playable: false,
    note: 'House crows are closely tied to human settlements and gather in communal roosts at night.', groupNoun: 'roost flock',
  },
  {
    id: 'myna', name: 'Common myna', sci: 'Acridotheres tristis', mass: 0.11, length: 0.25, walk: 0.8, run: 9, sprintS: 600,
    vision: 150, hearing: 70, smell: 0, activity: 'diurnal', lifespanY: 5, maturityY: 1, gestationD: 26, weanD: 30,
    intervalD: 150, litter: [1, 3], breedSeasons: [1, 2], intake: 0.03, feedHours: 6, foodWater: 0.35,
    diet: { veg: 0.45, invert: 1, fauna: 0, carrion: 0.1 }, prey: [], predators: ['jackal'], adultFearless: false, fleeDist: 12,
    group: 6, homeRange: 260, flies: true, habitat: { forest: 0.3, meadow: 0.9, wetland: 0.4, settlement: 1, dump: 0.4 },
    initial: 44, juvHazard: 0.02, adultHazard: 0.007, playable: false,
    note: 'Common mynas nest in cavities, including holes in buildings, and forage on the ground in small parties.', groupNoun: 'foraging party',
  },
];
export const SPECIES_INDEX: Record<SpeciesId, number> = { chital: 0, boar: 1, jackal: 2, hare: 3, crow: 4, myna: 5 };

/** Game-day conversions of the life-history parameters. */
export const lifeDays = (sp: SpeciesDef): number => (sp.lifespanY * 365) / LIFE_COMPRESSION;
export const maturityDays = (sp: SpeciesDef): number => (sp.maturityY * 365) / LIFE_COMPRESSION;
export const gestationHours = (sp: SpeciesDef): number => (sp.gestationD / LIFE_COMPRESSION) * 24;
export const weanDays = (sp: SpeciesDef): number => sp.weanD / LIFE_COMPRESSION;
export const intervalHours = (sp: SpeciesDef): number => (sp.intervalD / LIFE_COMPRESSION) * 24;
