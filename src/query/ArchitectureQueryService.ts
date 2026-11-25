import { RelateGraphRepository } from '../graph/RelateGraphRepository';
export const IMPACT_PATH_QUERY = `MATCH p = (m:Module)-[:IMPORTS*]->(target:Module {path:$module})
WHERE m.path <> target.path
UNWIND relationships(p) AS edge
RETURN DISTINCT startNode(edge).path AS from, endNode(edge).path AS to
ORDER BY from, to`;
export class ArchitectureQueryService {
  constructor(private readonly repository: RelateGraphRepository) {}
  dependenciesOf(module: string) {
    return this.repository.query('MATCH (:Module {path:$module})-[r:IMPORTS]->(m:Module) RETURN m.path AS path, m.layer AS layer, r.specifiers AS specifiers ORDER BY path', {module});
  }
  dependentsOf(module: string, transitive = false) {
    return this.repository.query(`MATCH (m:Module)-[:IMPORTS${transitive ? '*' : ''}]->(n:Module {path:$module}) WHERE m.path <> n.path RETURN DISTINCT m.path AS path, m.layer AS layer ORDER BY path`, {module});
  }
  impactPaths(module: string) {
    return { edges: this.repository.query(IMPACT_PATH_QUERY, {module}), query: IMPACT_PATH_QUERY };
  }
  typesIn(module: string) { return this.repository.query('MATCH (:Module {path:$module})-[:DECLARES]->(t:Type) RETURN t.name AS name, t.kind AS kind ORDER BY name', {module}); }
  layerSummary() { return this.repository.query('MATCH (l:Layer) OPTIONAL MATCH (m:Module)-[:IN_LAYER]->(l) RETURN l.name AS layer, count(m) AS modules, sum(m.loc) AS loc ORDER BY layer'); }
  violations() { return this.repository.violations(); }
  stats() {
    const count = (q: string) => this.repository.query(q)[0].count;
    return { modules: count('MATCH (m:Module) RETURN count(m) AS count'), types: count('MATCH (t:Type) RETURN count(t) AS count'), imports: count('MATCH ()-[r:IMPORTS]->() RETURN count(r) AS count'), constraints: count('MATCH (c:Constraint) RETURN count(c) AS count'), violations: this.violations().length };
  }
  graph() {
    return {
      // Snapshot layers are inserted in config order; retain that order without
      // adding a property to the persisted graph model.
      layers: this.repository.query('MATCH (l:Layer) RETURN l.name AS name ORDER BY id(l)'),
      nodes: this.repository.query('MATCH (m:Module) RETURN m.path AS path, m.layer AS layer, m.loc AS loc ORDER BY path'),
      edges: this.repository.query('MATCH (a:Module)-[r:IMPORTS]->(b:Module) RETURN a.path AS from, b.path AS to, r.specifiers AS specifiers ORDER BY from, to'),
      constraints: this.repository.query('MATCH (c:Constraint) RETURN c.id AS id, c.from AS from, c.to AS to, c.reason AS reason ORDER BY id')
    };
  }
}
