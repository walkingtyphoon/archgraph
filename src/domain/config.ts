import { ArchitectureConfig } from './model';
export function validateConfig(value: unknown): ArchitectureConfig {
  if (!value || typeof value !== 'object') throw new Error('Config must be an object');
  const c = value as ArchitectureConfig;
  if (!Array.isArray(c.layers) || !Array.isArray(c.constraints)) throw new Error('Config requires layers and constraints arrays');
  const names = new Set<string>();
  for (const l of c.layers) {
    if (!l || typeof l.name !== 'string' || !l.name || l.name === 'unassigned' || names.has(l.name) || typeof l.pattern !== 'string' || !l.pattern || l.pattern.startsWith('/') || l.pattern.includes('..') || /[?\[\]{}]/.test(l.pattern)) throw new Error('Invalid or duplicate layer; patterns support prefixes, * and **');
    names.add(l.name);
  }
  const ids = new Set<string>();
  for (const r of c.constraints) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !names.has(r.from) || !names.has(r.to) || r.rule !== 'must_not_import' || typeof r.reason !== 'string') throw new Error('Invalid or duplicate constraint');
    ids.add(r.id);
  }
  return c;
}
export function matchesLayer(path: string, pattern: string): boolean {
  if (!pattern.includes('*')) return path === pattern || path.startsWith(pattern.replace(/\/$/, '') + '/');
  const escaped = pattern.split('**').map(p => p.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp('^' + escaped + '$').test(path);
}
