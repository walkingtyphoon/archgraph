import { Database, Connection, ParamValue } from '@relate/relate';
import { ArchitectureSnapshot, Violation } from '../domain/model';
export const VIOLATION_QUERY = `MATCH (c:Constraint)-[:FORBIDS_FROM]->(lf:Layer)<-[:IN_LAYER]-(m:Module)-[:IMPORTS]->(n:Module)-[:IN_LAYER]->(lt:Layer)<-[:FORBIDS_TO]-(c)
RETURN c.id AS id, m.path AS from, n.path AS to, c.reason AS reason
ORDER BY id, from, to`;
export type Row = Record<string, unknown>;
function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, normalize(v)]));
  return value;
}
/** Relate 1.2 has no native close. close() checkpoints writers and revokes this wrapper;
 * the native store lease is released when the process exits. */
export class RelateGraphRepository {
  private readonly db: Database;
  private readonly conn: Connection;
  private closed = false;
  constructor(store: string, private readonly readOnly = true) {
    this.db = Database.open(store, { readOnly });
    this.conn = this.db.connect();
  }
  query(cypher: string, params: Record<string, ParamValue> = {}): Row[] {
    if (this.closed) throw new Error('Repository is closed');
    return normalize(this.conn.query(cypher, params).rows) as Row[];
  }
  replace(snapshot: ArchitectureSnapshot): void {
    if (this.readOnly) throw new Error('Repository is read-only');
    if (this.closed) throw new Error('Repository is closed');
    this.conn.begin();
    try {
      this.query('MATCH (n) DETACH DELETE n');
      const batch = (query: string, rows: unknown[]) => { if (rows.length) this.query(query, { rows: rows as ParamValue }); };
      batch('UNWIND $rows AS r CREATE (:Layer {name:r.name, pattern:r.pattern})', snapshot.layers);
      batch('UNWIND $rows AS r MATCH (l:Layer {name:r.layer}) CREATE (m:Module {path:r.path, layer:r.layer, loc:r.loc}) CREATE (m)-[:IN_LAYER]->(l)', snapshot.modules);
      batch('UNWIND $rows AS r MATCH (m:Module {path:r.module}) CREATE (t:Type {name:r.name, kind:r.kind, module:r.module}) CREATE (m)-[:DECLARES]->(t)', snapshot.types);
      batch('UNWIND $rows AS r MATCH (a:Module {path:r.from}), (b:Module {path:r.to}) CREATE (a)-[:IMPORTS {specifiers:r.specifiers}]->(b)', snapshot.imports);
      batch('UNWIND $rows AS r MATCH (m:Module {path:r.from}), (t:Type {module:r.module, name:r.name}) CREATE (m)-[:USES_TYPE]->(t)', snapshot.uses);
      batch('UNWIND $rows AS r MATCH (a:Layer {name:r.from}), (b:Layer {name:r.to}) CREATE (c:Constraint {id:r.id, from:r.from, to:r.to, rule:r.rule, reason:r.reason}) CREATE (c)-[:FORBIDS_FROM]->(a) CREATE (c)-[:FORBIDS_TO]->(b)', snapshot.constraints);
      this.conn.commit();
    } catch (error) { this.conn.rollback(); throw error; }
    this.db.checkpoint();
  }
  violations(): Violation[] { return this.query(VIOLATION_QUERY) as unknown as Violation[]; }
  close(): void { if (!this.closed) { if (!this.readOnly) this.db.checkpoint(); this.closed = true; } }
}
