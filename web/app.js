'use strict';
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const colors = ['#e0eaf9','#deeee5','#f8edcc','#eadff3','#e6e9e8'];
const stroke = ['#6886b0','#59977b','#b79d55','#9474b1','#899590'];
function element(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [key,value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}
function card(parent, text, bad = false) {
  const el = document.createElement('div'); el.className = 'card' + (bad ? ' bad-card' : ''); el.textContent = text; parent.append(el);
}
async function get(url) { const res = await fetch(url); if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`); return res.json(); }
let selection = 0;
async function select(path, graph) {
  const version = ++selection;
  const connected = new Set([path]);
  for (const edge of graph.edges) if (edge.from === path || edge.to === path) { connected.add(edge.from); connected.add(edge.to); }
  for (const node of document.querySelectorAll('.node')) node.classList.toggle('dim', !connected.has(node.dataset.path));
  $('details').replaceChildren(); card($('details'), `Loading ${path}…`);
  try {
    const detail = await get('/api/module?path=' + encodeURIComponent(path));
    if (version !== selection) return;
    $('details').replaceChildren(); const title = document.createElement('h3'); title.textContent = path; $('details').append(title);
    for (const [label, rows] of [['Dependencies',detail.dependencies],['Dependents',detail.dependents],['Transitive impact',detail.impact],['Exported types',detail.types]]) {
      const h = document.createElement('h2'); h.textContent = label; $('details').append(h);
      const ul = document.createElement('ul');
      for (const row of rows) { const li = document.createElement('li'); li.textContent = row.path || `${row.name} (${row.kind})`; ul.append(li); }
      if (!rows.length) { const li = document.createElement('li'); li.textContent = 'None'; ul.append(li); } $('details').append(ul);
    }
  } catch (e) { if (version === selection) card($('details'), e.message, true); }
}
async function load() {
  const [graph, violations, summary] = await Promise.all([get('/api/graph'),get('/api/violations'),get('/api/summary')]);
  $('stats').replaceChildren();
  for (const [label,count] of Object.entries(summary.stats)) { const div = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = count; div.append(strong,document.createTextNode(label)); $('stats').append(div); }
  for (const c of graph.constraints) card($('constraints'), `${c.from} → ${c.to} forbidden. ${c.reason}`);
  $('violation-title').textContent = `Violations / ${violations.length}`;
  for (const v of violations) card($('violations'), `${v.from} → ${v.to}\n${v.reason}`, true);
  if (!violations.length) card($('violations'), 'No architecture violations.');
  const preferred = ['ui','service','domain','db'];
  const layers = [...new Set(graph.nodes.map(n=>n.layer))].sort((a,b)=>(preferred.includes(a)?preferred.indexOf(a):99)-(preferred.includes(b)?preferred.indexOf(b):99)||a.localeCompare(b));
  const height = Math.max(500, ...layers.map(l=>graph.nodes.filter(n=>n.layer===l).length*100+100));
  const width = Math.max(720,layers.length*210);
  const svg = $('graph'); svg.setAttribute('viewBox',`0 0 ${width} ${height}`); svg.style.height = height+'px';
  const defs = element('defs');
  for (const [id,color] of [['arrow','#b1beb8'],['bad-arrow','#c83d43']]) { const marker = element('marker',{id,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'}); marker.append(element('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:color})); defs.append(marker); } svg.append(defs);
  const coords = new Map();
  layers.forEach((layer,i)=>{
    const x=i*(width/layers.length)+16;
    svg.append(element('text',{x,y:30,class:'lane',fill:stroke[i%stroke.length]},layer.toUpperCase()));
    graph.nodes.filter(n=>n.layer===layer).forEach((n,j)=>coords.set(n.path,{x,y:65+j*100,i}));
  });
  for (const edge of graph.edges) {
    const a=coords.get(edge.from),b=coords.get(edge.to);
    const bad=violations.some(v=>v.from===edge.from&&v.to===edge.to);
    const x1=a.x+86,y1=a.y+48,x2=b.x+86,y2=b.y;
    const line=element('path',{d:`M${x1},${y1} C${x1},${y1+38} ${x2},${y2-38} ${x2},${y2}`,class:'edge'+(bad?' bad':''),'marker-end':`url(#${bad?'bad-arrow':'arrow'})`});
    line.append(element('title',{},`${edge.from} → ${edge.to}`)); svg.append(line);
  }
  for (const n of graph.nodes) {
    const {x,y,i}=coords.get(n.path); const g=element('g',{class:'node',transform:`translate(${x},${y})`,tabindex:0,role:'button','aria-label':n.path}); g.dataset.path=n.path;
    g.append(element('rect',{width:174,height:48,rx:7,fill:colors[i%colors.length],stroke:stroke[i%stroke.length]}));
    const filename=n.path.split('/').pop();
    g.append(element('text',{x:10,y:20},filename.length>24?filename.slice(0,21)+'…':filename));
    g.append(element('text',{x:10,y:36,fill:'#627371'},`${n.loc} lines`)); g.append(element('title',{},n.path));
    g.addEventListener('click',()=>select(n.path,graph)); g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select(n.path,graph);}}); svg.append(g);
  }
  $('reset').onclick=()=>{selection++; document.querySelectorAll('.node').forEach(n=>n.classList.remove('dim')); $('details').replaceChildren(); card($('details'),'Select a module in the graph.');};
}
load().catch(e=>{$('stats').textContent=e.message;$('stats').className='error';});
