import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ai, health } from './lib/ai.js';
const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'64kb'}));
app.get('/api/health', health);
app.post('/api/ai', ai);
if (process.env.NODE_ENV === 'production') {
  const root=path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(root,'dist')));
  app.get('*',(_req,res)=>res.sendFile(path.join(root,'dist','index.html')));
}
const port=Number(process.env.PORT || 3001);
app.listen(port,'0.0.0.0',()=>console.log(`Kotoba local server http://localhost:${port}`));
