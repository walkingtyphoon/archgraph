#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { TypeScriptIndexer } from '../indexer/TypeScriptIndexer';
import { RelateGraphRepository } from '../graph/RelateGraphRepository';
import { ArchitectureQueryService } from '../query/ArchitectureQueryService';
import { createServer } from '../web/server';
function main() {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`Missing value for ${name}`);
    const value = args[i+1]; args.splice(i,2); return value;
  };
  const store = path.resolve(option('--store', 'store/archgraph.rl'));
  const port = Number(option('--port', '4317'));
  const transitive = args.includes('--transitive');
  const allow = args.includes('--allow-violations');
  const positional = args.filter(a => !['--transitive','--allow-violations'].includes(a));
  if (positional.some(a => a.startsWith('--'))) throw new Error('Unknown option');
  const [command, target] = positional;
  const commands = ['index','deps','dependents','violations','types','summary','cypher','serve'];
  if (!commands.includes(command)) throw new Error('Usage: archgraph index <projectDir> | deps <module> | dependents <module> [--transitive] | violations | types <module> | summary | cypher "query" | serve [--port 4317] [--store path]');
  if (['index','deps','dependents','types','cypher'].includes(command) && !target) throw new Error(`Missing argument for ${command}`);
  if (positional.length > (['index','deps','dependents','types','cypher'].includes(command) ? 2 : 1)) throw new Error('Too many arguments');
  if (command === 'index') {
    const snapshot = new TypeScriptIndexer().index(path.resolve(target));
    fs.mkdirSync(path.dirname(store), {recursive:true});
    const repository = new RelateGraphRepository(store, false);
    try { repository.replace(snapshot); console.log(JSON.stringify(new ArchitectureQueryService(repository).stats(),null,2)); }
    finally { repository.close(); }
    return;
  }
  const repository = new RelateGraphRepository(store, true);
  const service = new ArchitectureQueryService(repository);
  if (command === 'serve') {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
    const server = createServer(service);
    server.on('error', e => { console.error(e.message); repository.close(); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`archgraph: http://localhost:${port}`));
    const stop = () => server.close(() => { repository.close(); });
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  try {
    let result: unknown;
    switch (command) {
      case 'deps': result = service.dependenciesOf(target); break;
      case 'dependents': result = service.dependentsOf(target, transitive); break;
      case 'types': result = service.typesIn(target); break;
      case 'violations': result = service.violations(); if ((result as unknown[]).length && !allow) process.exitCode = 1; break;
      case 'summary': result = {stats:service.stats(), layers:service.layerSummary()}; break;
      case 'cypher': result = repository.query(target); break;
    }
    console.log(JSON.stringify(result,null,2));
  } finally { repository.close(); }
}
try { main(); } catch (e) { console.error(`archgraph: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 2; }
