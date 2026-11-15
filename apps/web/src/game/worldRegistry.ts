import { SPECIES, Simulation, SimSnapshot } from '@untamed/ecology';

export type WorldCategory = 'natural-earth' | 'deep-time' | 'myth' | 'cosmic' | 'alternative-earth';
/** How the world's content should be read: this label is shown to the player. */
export type WorldClassification = 'speculative-science' | 'scientific-reconstruction' | 'mythical' | 'cinematic-astronomy';
export type PlayerMode = 'observer' | 'wildlife' | 'experiment' | 'curiosity';

export interface WorldDescriptor {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: WorldCategory;
  classification: WorldClassification;
  defaultSeed: number;
  areaKm2: number;
  /** Creature ids available in this world. */
  creatures: string[];
  playable: string[];
  modes: PlayerMode[];
  landmarks: string[];
  /** Lowest graphics preset the world is designed to run at. */
  minQuality: 'low' | 'medium' | 'high';
  /** Save payload version this world reads and writes. */
  saveVersion: number;
  /**
   * Builds (or restores) the world's simulation. Called only when the player enters the world,
   * so worlds that are not selected cost nothing. Future worlds should use a dynamic import here
   * so their code is not even downloaded until chosen.
   */
  load(seed: number, snapshot?: SimSnapshot): Promise<Simulation>;
}

/**
 * The World Library. The application shell renders its destination list from this table
 * and knows nothing else about individual worlds; adding a destination means adding an entry.
 * Only worlds that actually exist are registered: planned destinations live in docs/ROADMAP.md.
 */
export const WORLDS: WorldDescriptor[] = [
  {
    id: 'reclaimed-valley',
    name: 'The Reclaimed Valley',
    tagline: 'South Asian mixed forest, a century after people',
    description: 'A river valley with forest, a ruined settlement, a waste dump, meadow and wetland. Deer, boar, jackals, hares, crows and mynas live by their own needs.',
    category: 'natural-earth',
    classification: 'speculative-science',
    defaultSeed: 1,
    areaKm2: 2.07,
    creatures: SPECIES.map((s) => s.id),
    playable: SPECIES.filter((s) => s.playable).map((s) => s.id),
    modes: ['observer', 'wildlife', 'experiment', 'curiosity'],
    landmarks: ['Broken river bridge', 'Water tower', 'Settlement hall', 'Leachate pools', 'Pylon line'],
    minQuality: 'low',
    saveVersion: 1,
    load: (seed, snapshot) => Promise.resolve(new Simulation(snapshot ? snapshot.seed : seed, snapshot)),
  },
];

export const CLASSIFICATION_LABEL: Record<WorldClassification, string> = {
  'speculative-science': 'Speculative, science-informed',
  'scientific-reconstruction': 'Scientific reconstruction',
  mythical: 'Mythical / imaginative',
  'cinematic-astronomy': 'Cinematic astronomy',
};

export function getWorld(id: string): WorldDescriptor | undefined {
  return WORLDS.find((w) => w.id === id);
}
