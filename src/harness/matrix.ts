import type { Backend, EngineId, ScenarioId, Variant } from './types';

// Scenario registry + run matrix. Pure data: imported by both the bench page and the Node runner.

export interface ScenarioDef {
  id: ScenarioId;
  title: string;
  levels: number[];
  levelLabel: string;
  variants: Variant[];
  backends: Backend[];
  engines: EngineId[];
  /** Workload group, for the report. */
  group: 'startup' | 'cpu' | 'gpu' | 'assets' | 'compute';
  /** Highest level per variant, where one path saturates the GPU long before the other. */
  maxLevel?: Partial<Record<Variant, number>>;
}

const MAIN: EngineId[] = ['three', 'playcanvas', 'babylon'];
const WITH_CLASSIC: EngineId[] = [...MAIN, 'three-classic'];
const BOTH: Backend[] = ['webgpu', 'webgl2'];

// Top levels that saturate the GPU for seconds per frame (forward lighting past 32 lights,
// 4M particles, 200 BrainStems, 1M instances) are left out: they freeze the desktop mid-run.
export const SCENARIOS: ScenarioDef[] = [
  { id: 's0', title: 'Startup: minimal lit cube', levels: [1], levelLabel: 'objects', variants: ['naive'], backends: BOTH, engines: WITH_CLASSIC, group: 'startup' },
  { id: 's1', title: 'Draw calls: unique animated meshes', levels: [1000, 2000, 5000, 10000, 20000, 50000], levelLabel: 'meshes', variants: ['naive', 'optimized'], backends: BOTH, engines: WITH_CLASSIC, group: 'cpu' },
  { id: 's2', title: 'Material variety (5k meshes)', levels: [10, 100, 1000], levelLabel: 'materials', variants: ['naive'], backends: BOTH, engines: WITH_CLASSIC, group: 'cpu' },
  { id: 's3', title: 'Instancing with per-frame updates', levels: [10000, 100000, 500000], levelLabel: 'instances', variants: ['optimized'], backends: BOTH, engines: WITH_CLASSIC, group: 'gpu' },
  { id: 's4', title: 'PBR + dynamic point lights', levels: [8, 32, 128, 512], maxLevel: { naive: 32 }, levelLabel: 'lights', variants: ['naive', 'optimized'], backends: BOTH, engines: WITH_CLASSIC, group: 'gpu' },
  { id: 's5', title: 'Shadows: CSM + 4 spot shadows', levels: [2000], levelLabel: 'meshes', variants: ['naive'], backends: BOTH, engines: WITH_CLASSIC, group: 'gpu' },
  { id: 's6', title: 'Post-processing: bloom + ACES', levels: [2000], levelLabel: 'meshes', variants: ['naive'], backends: BOTH, engines: MAIN, group: 'gpu' },
  { id: 's7', title: 'Sponza: load + flythrough', levels: [1], levelLabel: 'scene', variants: ['naive'], backends: BOTH, engines: WITH_CLASSIC, group: 'assets' },
  { id: 's8', title: 'Skinned characters (Fox)', levels: [10, 50, 200, 500], levelLabel: 'characters', variants: ['naive', 'optimized'], backends: BOTH, engines: WITH_CLASSIC, group: 'assets' },
  { id: 's8b', title: 'Skinned characters (BrainStem)', levels: [10, 50], levelLabel: 'characters', variants: ['naive'], backends: BOTH, engines: WITH_CLASSIC, group: 'assets' },
  { id: 's9', title: 'Compute: GPU particles', levels: [100000, 1000000], levelLabel: 'particles', variants: ['naive'], backends: ['webgpu'], engines: MAIN, group: 'compute' },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

/** three-classic is the classic WebGLRenderer: it only exists on the WebGL2 backend. */
export function engineSupports(engine: EngineId, backend: Backend) {
  return engine === 'three-classic' ? backend === 'webgl2' : true;
}

export interface Cell {
  engine: EngineId;
  backend: Backend;
  scenario: ScenarioId;
  variant: Variant;
  level: number;
}

export const cellKey = (c: Cell) => `${c.engine}|${c.backend}|${c.scenario}|${c.variant}|${c.level}`;
/** A ladder is a cell without its level — early stop applies per ladder. */
export const ladderKey = (c: Omit<Cell, 'level'>) => `${c.engine}|${c.backend}|${c.scenario}|${c.variant}`;

export function allCells(filter?: Partial<Record<keyof Cell, string[]>>): Cell[] {
  const out: Cell[] = [];
  const ok = (k: keyof Cell, v: string | number) => !filter?.[k] || filter[k]!.includes(String(v));
  for (const s of SCENARIOS) {
    if (!ok('scenario', s.id)) continue;
    for (const level of s.levels) {
      if (!ok('level', level)) continue;
      for (const variant of s.variants) {
        if (!ok('variant', variant)) continue;
        const cap = s.maxLevel?.[variant];
        if (cap !== undefined && level > cap) continue;
        for (const backend of s.backends) {
          if (!ok('backend', backend)) continue;
          for (const engine of s.engines) {
            if (!ok('engine', engine) || !engineSupports(engine, backend)) continue;
            out.push({ engine, backend, scenario: s.id, variant, level });
          }
        }
      }
    }
  }
  return out;
}
