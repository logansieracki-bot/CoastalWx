import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { systemsRouter } from './systems.js';
import { annotationsRouter } from './annotations.js';
import { forecastPointsRouter } from './forecastPoints.js';
import { authRouter } from './auth.js';
import { advisoriesRouter } from './advisories.js';
import { positionLogRouter } from './positionLog.js';
import { startBackupSchedule } from './backup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = join(__dirname, '..', '..', 'editor');
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

const app = express();
app.use(express.json());
app.use('/api', authRouter);
app.use('/api', systemsRouter);
app.use('/api', annotationsRouter);
app.use('/api', forecastPointsRouter);
app.use('/api', advisoriesRouter);
app.use('/api', positionLogRouter);
// The forecaster tool lives at /editor (bookmarked internally, gated by
// login); the read-only public site is what the bare domain serves --
// visitors land on the public page by default, not the editor.
app.use('/editor', express.static(EDITOR_DIR));
app.use(express.static(PUBLIC_DIR));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NorEASterCaster editor server listening on http://localhost:${PORT}`);
});

startBackupSchedule();
