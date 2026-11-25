'use strict';
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const layerColors = ['#6b8de3', '#49a58b', '#c59b4b', '#ba7b9c', '#899590'];
const edgeKey = edge => JSON.stringify([edge.from, edge.to]);
const nodeElements = new Map();
const edgeElements = new Map();
let selectionVersion = 0;
let edgeGroups;

function svgElement(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}
function htmlElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

// This only styles the nodes/edges returned by Relate; it never traverses the graph.
function highlight(path, detail) {
  const impacted = new Set(detail.impact.map(node => node.path));
  const related = new Set([path, ...impacted, ...detail.dependencies.map(node => node.path)]);
  const impactEdges = new Set(detail.impactPaths.edges.map(edgeKey));
  for (const [name, node] of nodeElements) {
    node.classList.toggle('selected', name === path);
    node.classList.toggle('impact', impacted.has(name));
    node.classList.toggle('dim', !related.has(name));
    node.setAttribute('aria-pressed', String(name === path));
  }
  for (const [key, line] of edgeElements) {
    const impact = impactEdges.has(key);
    const bad = line.classList.contains('bad');
    line.classList.toggle('impact', impact);
    line.classList.toggle('connected', line.dataset.from === path || line.dataset.to === path);
    line.setAttribute('marker-end', `url(#${bad ? 'bad-arrow' : impact ? 'impact-arrow' : 'arrow'})`);
    // Keep the red violation above all normal and purple paths, in every state.
    edgeGroups[bad ? 'violation' : impact ? 'impact' : 'normal'].append(line);
  }
}
function clearHighlight() {
  for (const node of nodeElements.values()) {
    node.classList.remove('selected', 'impact', 'dim');
    node.setAttribute('aria-pressed', 'false');
  }
  for (const line of edgeElements.values()) {
    line.classList.remove('impact', 'focused', 'connected', 'hovered');
    const bad = line.classList.contains('bad');
    line.setAttribute('marker-end', `url(#${bad ? 'bad-arrow' : 'arrow'})`);
    edgeGroups[bad ? 'violation' : 'normal'].append(line);
  }
}
function reset() {
  selectionVersion++;
  clearHighlight();
  $('reset').disabled = true;
  $('selection-label').textContent = 'Select a module to trace its impact. Arrows point to dependencies.';
  $('details').classList.remove('dense');
  $('details').replaceChildren(
    htmlElement('h2', '', 'Module inspector'),
    htmlElement('p', 'muted', 'Select a module to see dependencies and transitive impact, computed by Relate.')
  );
}
function renderDetails(path, detail) {
  const panel = htmlElement('div', 'impact-panel');
  const heading = htmlElement('h2', '', 'Transitive impact');
  heading.append(htmlElement('span', 'count', String(detail.impact.length)));
  panel.append(heading);
  if (detail.impact.length) {
    const list = htmlElement('ul', 'impact-list');
    for (const node of detail.impact) list.append(htmlElement('li', '', node.path));
    panel.append(list);
  } else {
    panel.append(htmlElement('p', 'impact-empty', 'No other modules depend on this module.'));
  }
  const cypher = htmlElement('details', 'cypher-box');
  cypher.append(htmlElement('summary', '', 'Cypher'));
  const pre = htmlElement('pre');
  pre.append(htmlElement('code', '', detail.impactPaths.query));
  cypher.append(pre, htmlElement('div', 'query-param', `$module = ${JSON.stringify(path)}`));
  panel.append(cypher);
  const details = htmlElement('dl');
  for (const [label, rows] of [['Dependencies', detail.dependencies], ['Dependents', detail.dependents], ['Exported types', detail.types]]) {
    const row = htmlElement('div', 'detail-row');
    const content = htmlElement('dd');
    const list = htmlElement('ul');
    for (const item of rows) list.append(htmlElement('li', '', item.path || `${item.name} (${item.kind})`));
    if (!rows.length) list.append(htmlElement('li', '', 'None'));
    content.append(list);
    row.append(htmlElement('dt', '', label), content);
    details.append(row);
  }
  const connections = htmlElement('details', 'connection-details');
  connections.open = true;
  $('details').classList.toggle('dense', detail.impact.length > 5);
  connections.append(htmlElement('summary', '', `Direct connections & types · ${detail.dependencies.length} / ${detail.dependents.length} / ${detail.types.length}`), details);
  $('details').replaceChildren(htmlElement('h3', '', path), panel, connections);
}
async function select(path, violation) {
  const version = ++selectionVersion;
  clearHighlight();
  nodeElements.get(path)?.classList.add('selected');
  $('reset').disabled = false;
  $('selection-label').textContent = `Tracing impact of ${path}…`;
  $('details').replaceChildren(htmlElement('p', 'muted', `Loading ${path}…`));
  try {
    const detail = await get('/api/module?path=' + encodeURIComponent(path));
    if (version !== selectionVersion) return;
    highlight(path, detail);
    if (violation) edgeElements.get(edgeKey(violation))?.classList.add('focused');
    const count = detail.impact.length;
    $('selection-label').textContent = violation
      ? `Forbidden import: ${violation.from} → ${violation.to}`
      : `${path} · ${count} transitive dependent${count === 1 ? '' : 's'} · impact paths computed by Relate`;
    renderDetails(path, detail);
  } catch (error) {
    if (version !== selectionVersion) return;
    clearHighlight();
    $('selection-label').textContent = 'Impact query failed. Reset selection or try another module.';
    $('details').replaceChildren(htmlElement('p', 'error', error.message));
  }
}

function renderLegend(layers) {
  const legend = $('legend');
  layers.forEach((layer, index) => {
    const item = htmlElement('span', 'legend-item');
    const swatch = htmlElement('span', 'swatch');
    swatch.style.background = layerColors[index % layerColors.length];
    item.append(swatch, document.createTextNode(layer)); legend.append(item);
  });
  for (const [label, kind] of [['Import', ''], ['Violation', 'violation'], ['Impact path', 'impact']]) {
    const item = htmlElement('span', 'legend-item');
    item.append(htmlElement('span', `line-key ${kind}`), document.createTextNode(label));
    legend.append(item);
  }
}

function hoverModule(path, active) {
  for (const line of edgeElements.values()) {
    if (line.dataset.from === path || line.dataset.to === path) line.classList.toggle('hovered', active);
  }
}

function drawGraph(graph, violations, layers) {
  const svg = $('graph');
  const width = Math.max(900, layers.length * 232);
  const nodeWidth = 160;
  const nodeHeight = 56;
  const largestLayer = Math.max(1, ...layers.map(layer => graph.nodes.filter(n => n.layer === layer).length));
  const height = Math.max(424, 64 + largestLayer * 88);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const defs = svgElement('defs');
  for (const [id, color] of [['arrow', 'var(--edge)'], ['bad-arrow', 'var(--danger)'], ['impact-arrow', 'var(--impact)']]) {
    const marker = svgElement('marker', {id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto'});
    marker.append(svgElement('path', {d: 'M 0 0 L 10 5 L 0 10 z', fill: color}));
    defs.append(marker);
  }
  svg.append(defs);
  edgeGroups = Object.fromEntries(['normal', 'impact', 'violation'].map(name => [name, svgElement('g', {'data-edges': name})]));
  svg.append(...Object.values(edgeGroups));
  const coords = new Map();
  layers.forEach((layer, index) => {
    const x = index * (width / layers.length) + 20;
    const color = layerColors[index % layerColors.length];
    const title = layer === 'ui' ? 'UI' : layer === 'db' ? 'DB' : layer.charAt(0).toUpperCase() + layer.slice(1);
    const pill = svgElement('g', {class: 'layer-pill', transform: `translate(${x},16)`});
    pill.style.setProperty('--layer', color);
    pill.append(svgElement('rect', {width: Math.max(56, title.length * 7 + 32), height: 26, rx: 13}));
    pill.append(svgElement('circle', {cx: 13, cy: 13, r: 3}));
    pill.append(svgElement('text', {x: 23, y: 17, class: 'lane'}, title));
    svg.append(pill);
    graph.nodes.filter(n => n.layer === layer).forEach((node, row) => coords.set(node.path, {x, y: 80 + row * 88, index}));
  });

  // Ports and curvature are visual only; Relate still owns the graph and paths.
  const pairs = new Map();
  const incoming = new Map();
  const outgoing = new Map();
  const add = (map, key, edge) => { if (!map.has(key)) map.set(key, []); map.get(key).push(edge); };
  for (const edge of graph.edges) {
    const a = coords.get(edge.from), b = coords.get(edge.to);
    add(pairs, `${a.index}:${b.index}`, edge);
    add(outgoing, edge.from, edge);
    add(incoming, edge.to, edge);
  }
  for (const edge of graph.edges) {
    const a = coords.get(edge.from), b = coords.get(edge.to);
    const bad = violations.some(v => edgeKey(v) === edgeKey(edge));
    const pair = pairs.get(`${a.index}:${b.index}`);
    const slot = pair.indexOf(edge);
    const offset = slot - (pair.length - 1) / 2;
    const direction = b.index >= a.index ? 1 : -1;
    const x1 = a.x + (direction > 0 ? nodeWidth : 0);
    const x2 = b.x + (direction > 0 ? 0 : nodeWidth);
    const portY = (node, edges) => node.y + nodeHeight * (edges.indexOf(edge) + 1) / (edges.length + 1);
    const y1 = portY(a, outgoing.get(edge.from));
    const y2 = portY(b, incoming.get(edge.to));
    let route;
    if (a.index === b.index) {
      const gutter = a.x + nodeWidth + 24 + slot * 8;
      route = `M${a.x + nodeWidth},${y1} C${gutter},${y1} ${gutter},${y2} ${b.x + nodeWidth},${y2}`;
    } else {
      const distance = Math.abs(x2 - x1);
      const reach = Math.min(160, distance * .4) + offset * 8;
      const bend = bad ? 48 : offset * 12;
      route = `M${x1},${y1} C${x1 + direction * reach},${y1 + bend} ${x2 - direction * reach},${y2 + bend} ${x2},${y2}`;
    }
    const line = svgElement('path', {d: route, class: `edge${bad ? ' bad' : ''}`, 'marker-end': `url(#${bad ? 'bad-arrow' : 'arrow'})`});
    line.dataset.from = edge.from; line.dataset.to = edge.to;
    line.append(svgElement('title', {}, `${edge.from} → ${edge.to}${bad ? ' · architecture violation' : ''}`));
    edgeGroups[bad ? 'violation' : 'normal'].append(line);
    edgeElements.set(edgeKey(edge), line);
  }
  for (const node of graph.nodes) {
    const {x, y, index} = coords.get(node.path);
    const group = svgElement('g', {class: 'node', transform: `translate(${x},${y})`, tabindex: 0, role: 'button', 'aria-label': node.path, 'aria-pressed': 'false'});
    group.dataset.path = node.path;
    group.style.setProperty('--layer', layerColors[index % layerColors.length]);
    group.append(svgElement('rect', {class: 'node-card', width: nodeWidth, height: nodeHeight, rx: 10}));
    group.append(svgElement('circle', {class: 'node-dot', cx: 15, cy: 21, r: 3}));
    const filename = node.path.split('/').pop();
    const label = svgElement('text', {x: 26, y: 25, class: 'node-name'}, filename);
    if (filename.length > 22) { label.setAttribute('textLength', nodeWidth - 36); label.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
    group.append(label, svgElement('text', {x: 26, y: 42, class: 'node-meta'}, `${node.loc} lines`), svgElement('title', {}, node.path));
    group.addEventListener('click', () => select(node.path));
    group.addEventListener('pointerenter', () => hoverModule(node.path, true));
    group.addEventListener('pointerleave', () => hoverModule(node.path, false));
    group.addEventListener('focus', () => hoverModule(node.path, true));
    group.addEventListener('blur', () => hoverModule(node.path, false));
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.path); }
    });
    svg.append(group); nodeElements.set(node.path, group);
  }
}

async function load() {
  const [graph, violations, summary] = await Promise.all([get('/api/graph'), get('/api/violations'), get('/api/summary')]);
  $('stats').replaceChildren();
  for (const [label, count] of Object.entries(summary.stats)) {
    const stat = htmlElement('div', label === 'violations' && count ? 'has-violations' : '');
    stat.append(htmlElement('strong', '', String(count)), document.createTextNode(label)); $('stats').append(stat);
  }
  for (const constraint of graph.constraints) {
    const card = htmlElement('details', 'rule');
    const summary = htmlElement('summary');
    summary.append(htmlElement('span', 'constraint-route', `${constraint.from} → ${constraint.to}`), htmlElement('span', 'rule-state', 'Forbidden'));
    card.append(summary, htmlElement('p', 'constraint-reason', constraint.reason));
    $('constraints').append(card);
  }
  $('violation-title').textContent = `Violations / ${violations.length}`;
  for (const violation of violations) {
    const card = htmlElement('button', 'card violation-card', `${violation.from} → ${violation.to}`);
    card.setAttribute('aria-label', `Focus violation: ${violation.from} → ${violation.to}`);
    card.append(htmlElement('span', '', violation.reason));
    card.addEventListener('click', () => select(violation.from, violation));
    $('violations').append(card);
  }
  if (!violations.length) $('violations').append(htmlElement('p', 'muted', 'No architecture violations.'));
  const layers = graph.layers.map(layer => layer.name);
  renderLegend(layers);
  drawGraph(graph, violations, layers);
  $('reset').addEventListener('click', reset);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') reset(); });
  reset();
}
load().catch(error => { $('stats').textContent = error.message; $('stats').className = 'error'; });
