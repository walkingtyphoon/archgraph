import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ArchitectureQueryService } from '../query/ArchitectureQueryService';
export function createServer(service: ArchitectureQueryService): http.Server {
  const assets = path.resolve(__dirname, '../../web');
  return http.createServer((req, res) => {
    try {
      if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      let result: unknown;
      switch (url.pathname) {
        case '/api/graph': result = service.graph(); break;
        case '/api/violations': result = service.violations(); break;
        case '/api/summary': result = {stats: service.stats(), layers: service.layerSummary()}; break;
        case '/api/module': {
          const module = url.searchParams.get('path') ?? '';
          result = { dependencies: service.dependenciesOf(module), dependents: service.dependentsOf(module), impact: service.dependentsOf(module, true), types: service.typesIn(module) }; break;
        }
        default: {
          const asset = url.pathname === '/' ? 'index.html' : url.pathname === '/app.js' ? 'app.js' : null;
          if (!asset) { res.writeHead(404).end('Not found'); return; }
          res.writeHead(200, {'Content-Type': asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'"});
          res.end(fs.readFileSync(path.join(assets, asset))); return;
        }
      }
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
      res.end(JSON.stringify(result));
    } catch (e) { res.writeHead(500, {'Content-Type':'application/json'}).end(JSON.stringify({error: e instanceof Error ? e.message : String(e)})); }
  });
}
