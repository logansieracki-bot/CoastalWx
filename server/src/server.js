import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { systemsRouter } from './systems.js';
import { annotationsRouter } from './annotations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = join(__dirname, '..', '..', 'editor');

const app = express();
app.use(express.json());
app.use('/api', systemsRouter);
app.use('/api', annotationsRouter);
app.use(express.static(EDITOR_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NorEASterCaster editor server listening on http://localhost:${PORT}`);
});
