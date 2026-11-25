export interface Layer { name: string; pattern: string }
export interface Constraint { id: string; from: string; to: string; rule: 'must_not_import'; reason: string }
export interface ModuleNode { path: string; layer: string; loc: number }
export interface TypeNode { name: string; kind: string; module: string }
export interface ImportEdge { from: string; to: string; specifiers: string[] }
export interface TypeUse { from: string; module: string; name: string }
export interface Violation { id: string; from: string; to: string; reason: string }
export interface ArchitectureSnapshot { layers: Layer[]; constraints: Constraint[]; modules: ModuleNode[]; types: TypeNode[]; imports: ImportEdge[]; uses: TypeUse[] }
export interface ArchitectureConfig { layers: Layer[]; constraints: Constraint[] }
