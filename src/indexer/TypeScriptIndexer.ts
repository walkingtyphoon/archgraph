import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { ArchitectureSnapshot, ImportEdge } from '../domain/model';
import { validateConfig, matchesLayer } from '../domain/config';
export class TypeScriptIndexer {
  index(projectDir: string): ArchitectureSnapshot {
    const root = fs.realpathSync(projectDir);
    const config = validateConfig(JSON.parse(fs.readFileSync(path.join(root, 'archgraph.config.json'), 'utf8')));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
        if (e.isSymbolicLink() || ['node_modules', 'dist', '.git', 'store'].includes(e.name)) continue;
        const absolute = path.join(dir, e.name);
        if (e.isDirectory()) walk(absolute);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(absolute);
      }
    };
    walk(root);
    const relative = (p: string) => path.relative(root, p).split(path.sep).join('/');
    let options: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Node10, jsx: ts.JsxEmit.Preserve };
    const configPath = path.join(root, 'tsconfig.json');
    if (fs.existsSync(configPath)) {
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
      if (parsed.errors.length) throw new Error(parsed.errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'));
      options = parsed.options;
    }
    const snapshot: ArchitectureSnapshot = { ...config, layers: [...config.layers], modules: [], types: [], imports: [], uses: [] };
    const program = ts.createProgram(files, options);
    const checker = program.getTypeChecker();
    const known = new Set(files);
    const pending: { edge: ImportEdge; names: string[] }[] = [];
    for (const file of files) {
      const source = program.getSourceFile(file)!;
      const module = relative(file);
      const layers = config.layers.filter(l => matchesLayer(module, l.pattern));
      if (layers.length > 1) throw new Error(`Ambiguous layer assignment: ${module}`);
      snapshot.modules.push({ path: module, layer: layers[0]?.name ?? 'unassigned', loc: source.text ? source.text.trimEnd().split(/\r?\n/).length : 0 });
      const moduleSymbol = checker.getSymbolAtLocation(source);
      for (const exported of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
        const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        for (const declaration of symbol.declarations ?? []) {
          if (declaration.getSourceFile() !== source) continue;
          const kind = ts.isInterfaceDeclaration(declaration) ? 'interface' : ts.isTypeAliasDeclaration(declaration) ? 'type' : ts.isClassDeclaration(declaration) ? 'class' : ts.isEnumDeclaration(declaration) ? 'enum' : undefined;
          if (kind && !snapshot.types.some(t => t.module === module && t.name === exported.name)) snapshot.types.push({ name: exported.name, kind, module });
        }
      }
      for (const statement of source.statements) {
        let specifier: string | undefined;
        let names: string[] = [];
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          specifier = statement.moduleSpecifier.text;
          const clause = statement.importClause;
          if (clause?.name) names.push('default');
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) names.push(...clause.namedBindings.elements.map(e => (e.propertyName ?? e.name).text));
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          specifier = statement.moduleSpecifier.text;
          if (statement.exportClause && ts.isNamedExports(statement.exportClause)) names = statement.exportClause.elements.map(e => (e.propertyName ?? e.name).text);
        } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && statement.moduleReference.expression && ts.isStringLiteral(statement.moduleReference.expression)) specifier = statement.moduleReference.expression.text;
        if (!specifier?.startsWith('.')) continue;
        const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
        if (!resolved || !known.has(path.resolve(resolved))) throw new Error(`Unresolved local import ${specifier} in ${module}`);
        const target = relative(resolved);
        let edge = snapshot.imports.find(e => e.from === module && e.to === target);
        if (!edge) { edge = { from: module, to: target, specifiers: [] }; snapshot.imports.push(edge); }
        edge.specifiers = [...new Set([...edge.specifiers, ...names])].sort();
        pending.push({ edge, names });
      }
    }
    if (snapshot.modules.some(m => m.layer === 'unassigned')) snapshot.layers.push({ name: 'unassigned', pattern: '' });
    for (const {edge, names} of pending) for (const name of names) {
      const type = snapshot.types.find(t => t.module === edge.to && t.name === name);
      if (type && !snapshot.uses.some(u => u.from === edge.from && u.module === type.module && u.name === type.name)) snapshot.uses.push({ from: edge.from, module: type.module, name: type.name });
    }
    return snapshot;
  }
}
