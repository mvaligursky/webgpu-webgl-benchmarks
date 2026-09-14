import { scenarioById } from './matrix';
import type { RunParams } from './types';

export const DEFAULTS = {
  backend: 'webgpu',
  variant: 'naive',
  mode: 'timing',
  repeat: 0,
  warmupFrames: 120,
  warmupMs: 2000,
  measureFrames: 300,
  measureMs: 5000,
  maxMeasureMs: 15000,
  gpuTiming: true,
} as const;

export function parseParams(search: string | URLSearchParams): RunParams {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
  const bool = (k: string) => q.get(k) === '1' || q.get(k) === 'true';
  const scenario = (q.get('scenario') ?? 's1') as RunParams['scenario'];
  const def = scenarioById(scenario);
  return {
    engine: (q.get('engine') ?? 'three') as RunParams['engine'],
    backend: (q.get('backend') ?? DEFAULTS.backend) as RunParams['backend'],
    scenario,
    variant: (q.get('variant') ?? DEFAULTS.variant) as RunParams['variant'],
    level: num('level', def?.levels[0] ?? 1),
    mode: (q.get('mode') ?? DEFAULTS.mode) as RunParams['mode'],
    repeat: num('repeat', DEFAULTS.repeat),
    warmupFrames: num('warmupFrames', DEFAULTS.warmupFrames),
    warmupMs: num('warmupMs', DEFAULTS.warmupMs),
    measureFrames: num('measureFrames', DEFAULTS.measureFrames),
    measureMs: num('measureMs', DEFAULTS.measureMs),
    maxMeasureMs: num('maxMeasureMs', DEFAULTS.maxMeasureMs),
    screenshot: bool('screenshot'),
    standalone: bool('standalone'),
    gpuTiming: q.get('gpuTiming') !== '0',
    opt: q.get('opt') ?? undefined,
    session: q.get('session') ?? undefined,
    runId: q.get('runId') ?? undefined,
    tag: (q.get('tag') ?? undefined) as RunParams['tag'],
  };
}

/** Serialize only what differs from defaults, so URLs stay readable. */
export function toSearch(p: Partial<RunParams>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null) continue;
    if ((DEFAULTS as Record<string, unknown>)[k] === v) continue;
    if (typeof v === 'boolean') {
      q.set(k, v ? '1' : '0');
      continue;
    }
    q.set(k, String(v));
  }
  return q.toString();
}
