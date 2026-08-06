import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

import { authMiddleware, errorMiddleware, notFoundHandler } from './routes/middleware.js';
import { usersRouter } from './routes/users.js';
import { bootstrapRouter } from './routes/bootstrap.js';
import { projectsRouter } from './routes/projects.js';
import { tasksRouter } from './routes/tasks.js';
import { roadblocksRouter } from './routes/roadblocks.js';
import { approvalsRouter } from './routes/approvals.js';
import { auditRouter } from './routes/audit.js';
import { syncRouter } from './routes/sync.js';
import { reportsRouter } from './routes/reports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = path.join(__dirname, '..', 'openapi.yaml');

/** App factory — inject any repository implementing the repo interface. */
export function createApp({ repo }) {
  const app = express();
  app.locals.repo = repo;
  app.disable('x-powered-by');
  app.use(cors({ exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '4mb' }));

  // ---- public endpoints ----------------------------------------------------
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/users', usersRouter());

  const openapiText = readFileSync(OPENAPI_PATH, 'utf8');
  const openapiSpec = YAML.parse(openapiText);
  app.get('/api/openapi.yaml', (req, res) => {
    res.type('text/yaml').send(openapiText);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'OpsPM360 API Docs',
  }));

  // ---- authenticated endpoints ---------------------------------------------
  app.use('/api', authMiddleware);
  app.use('/api/bootstrap', bootstrapRouter());
  app.use('/api/projects', projectsRouter());
  app.use('/api/tasks', tasksRouter());
  app.use('/api/roadblocks', roadblocksRouter());
  app.use('/api/approvals', approvalsRouter());
  app.use('/api/audit', auditRouter());
  app.use('/api/sync', syncRouter());
  app.use('/api/reports', reportsRouter());

  app.use(notFoundHandler);
  app.use(errorMiddleware);
  return app;
}
