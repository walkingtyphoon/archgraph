const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {TypeScriptIndexer} = require('../dist/indexer/TypeScriptIndexer');
const {validateConfig} = require('../dist/domain/config');
const {RelateGraphRepository} = require('../dist/graph/RelateGraphRepository');
const {ArchitectureQueryService} = require('../dist/query/ArchitectureQueryService');
const {createServer} = require('../dist/web/server');
const sample = path.resolve('examples/clinic-app');
const snapshot = () => new TypeScriptIndexer().index(sample);
test('sample indexes 12 modules with layers, barrel/tsx/explicit extension imports, aliases and exported kinds', () => {
  const s = snapshot();
  assert.equal(s.modules.length,12);
  assert.equal(s.modules.filter(m=>m.layer==='domain').length,4);
  assert.equal(s.modules.find(m=>m.path==='ui/App.ts').layer,'ui');
  for (const [from,to] of [['ui/App.ts','domain/index.ts'],['ui/App.ts','ui/PatientCard.tsx'],['ui/PatientCard.tsx','domain/patient.ts']]) assert.ok(s.imports.some(e=>e.from===from&&e.to===to));
  assert.equal(s.types.length,10);
  assert.deepEqual([...new Set(s.types.map(t=>t.kind))].sort(),['class','enum','interface','type']);
  assert.ok(s.uses.some(u=>u.from==='ui/PatientCard.tsx'&&u.name==='Patient'));
});
test('invalid config, overlapping layers and unresolved local imports fail loudly', () => {
  assert.throws(()=>validateConfig({layers:[],constraints:[{id:'bad',from:'missing',to:'none'}]}));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archgraph-index-'));
  try {
    const config={layers:[{name:'one',pattern:'**'}],constraints:[]};
    fs.writeFileSync(path.join(dir,'archgraph.config.json'),JSON.stringify(config));
    fs.writeFileSync(path.join(dir,'a.ts'),"import './missing';");
    assert.throws(()=>new TypeScriptIndexer().index(dir),/Unresolved/);
    fs.writeFileSync(path.join(dir,'a.ts'),'export interface A {}');
    config.layers.push({name:'two',pattern:'**'});
    fs.writeFileSync(path.join(dir,'archgraph.config.json'),JSON.stringify(config));
    assert.throws(()=>new TypeScriptIndexer().index(dir),/Ambiguous/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('local export lists, default declarations and repeated imports preserve public type names', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archgraph-exports-'));
  try {
    fs.writeFileSync(path.join(dir,'archgraph.config.json'),JSON.stringify({layers:[],constraints:[]}));
    fs.writeFileSync(path.join(dir,'types.ts'),'interface Internal {}\nexport { Internal as Public };\nexport default class DefaultType {}');
    fs.writeFileSync(path.join(dir,'use.ts'),"import Main from './types';\nimport type { Public as Renamed } from './types';");
    const s=new TypeScriptIndexer().index(dir);
    assert.deepEqual(s.types.map(t=>t.name).sort(),['Public','default']);
    assert.equal(s.imports.length,1);
    assert.deepEqual(s.imports[0].specifiers,['Public','default']);
    assert.deepEqual(s.uses.map(u=>u.name).sort(),['Public','default']);
    assert.ok(s.modules.every(m=>m.layer==='unassigned'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('Relate round-trip, exact violation, graph traversal, atomic replacement and rollback', () => {
  const r=new RelateGraphRepository(':memory:',false); const q=new ArchitectureQueryService(r);
  try {
    r.replace(snapshot());
    assert.deepEqual(q.stats(),{modules:12,types:10,imports:16,constraints:2,violations:1});
    assert.deepEqual(q.violations(),[{id:'ui-no-db',from:'ui/PatientList.ts',to:'db/patientRepository.ts',reason:'UI must use services instead of accessing storage directly.'}]);
    assert.ok(q.dependentsOf('db/connection.ts',true).some(m=>m.path==='ui/App.ts'));
    assert.ok(!q.dependentsOf('db/connection.ts').some(m=>m.path==='ui/App.ts'));
    assert.equal(q.typesIn('domain/patient.ts').length,2);
    assert.equal(q.graph().edges.length,16);
    assert.equal(q.layerSummary().length,4);
    r.replace(snapshot()); assert.equal(q.stats().modules,12);
    const broken=snapshot(); broken.modules[0].loc=()=>{};
    assert.throws(()=>r.replace(broken)); assert.equal(q.stats().modules,12);
    r.query('MATCH (a:Module {path:$a}), (b:Module {path:$b}) CREATE (a)-[:IMPORTS]->(b)',{a:'db/connection.ts',b:'ui/App.ts'});
    assert.ok(!q.dependentsOf('ui/App.ts',true).some(m=>m.path==='ui/App.ts'));
  } finally { r.close(); }
  assert.throws(()=>r.query('RETURN 1'),/closed/);
});
test('persistent store reopens in another process; read-only refuses writes and CLI exits 1', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archgraph-store-'));const store=path.join(dir,'test.rl');
  const run=(...args)=>spawnSync(process.execPath,['dist/cli/main.js',...args,'--store',store],{encoding:'utf8'});
  try {
    const index=run('index',sample);assert.equal(index.status,0,index.stderr);
    const violations=run('violations');assert.equal(violations.status,1,violations.stderr);assert.equal(JSON.parse(violations.stdout).length,1);
    const read=run('cypher','MATCH (m:Module) RETURN count(m) AS count');assert.equal(read.status,0,read.stderr);assert.equal(JSON.parse(read.stdout)[0].count,12);
    assert.notEqual(run('cypher','CREATE (:Bad)').status,0);
    const after=run('cypher','MATCH (n:Bad) RETURN count(n) AS count');assert.equal(JSON.parse(after.stdout)[0].count,0);
    assert.notEqual(run('deps').status,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('HTTP serves offline assets and store-backed APIs', async () => {
  const r=new RelateGraphRepository(':memory:',false);r.replace(snapshot());
  const server=createServer(new ArchitectureQueryService(r));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.match(await (await fetch(base)).text(),/Architecture memory/);
    assert.equal((await (await fetch(base+'/api/graph')).json()).nodes.length,12);
    assert.equal((await (await fetch(base+'/api/violations')).json()).length,1);
    assert.equal((await (await fetch(base+'/api/summary')).json()).stats.modules,12);
    const detail=await (await fetch(base+'/api/module?path=db%2Fconnection.ts')).json();assert.ok(detail.impact.length>detail.dependents.length);
    assert.equal((await fetch(base+'/app.js')).status,200);
    assert.equal((await fetch(base+'/missing')).status,404);
    assert.equal((await fetch(base,{method:'POST'})).status,405);
  } finally {await new Promise(resolve=>server.close(resolve));r.close();}
});
