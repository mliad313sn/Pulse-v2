import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

import {
  authMiddleware, errorMiddleware, forbidViewerWrites, notFoundHandler, requirePasswordChanged,
} from './routes/middleware.js';
import { authRouter } from './routes/auth.js';
import { createEntraProvider } from './services/authProviders/entra.js';
import { usersRouter } from './routes/users.js';
import { divisionsRouter, orgRouter, sitesRouter } from './routes/org.js';
import { pillarsRouter, portfoliosRouter, programsRouter } from './routes/portfolios.js';
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

/**
 * App factory — inject any repository implementing the repo interface.
 * `authProvider` (SSO adapter) defaults to Entra-from-env; tests inject
 * the fake provider.
 */
export function createApp({ repo, authProvider = createEntraProvider() }) {
  const app = express();
  app.locals.repo = repo;
  app.disable('x-powered-by');
  app.use(cors({ credentials: true, origin: true, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '4mb' }));

  // ---- public endpoints ----------------------------------------------------
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  // Auth lifecycle (login/logout/me/change-password/revoke-all/SSO) — handles
  // its own session resolution so it works while mustChangePassword=true.
  app.use('/api/auth', authRouter({ authProvider }));

  const openapiText = readFileSync(OPENAPI_PATH, 'utf8');
  const openapiSpec = YAML.parse(openapiText);
  app.get('/api/openapi.yaml', (req, res) => {
    res.type('text/yaml').send(openapiText);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'OpsPM360 API Docs',
  }));

  // ---- authenticated endpoints ---------------------------------------------
  app.use('/api', authMiddleware, requirePasswordChanged, forbidViewerWrites);
  app.use('/api/users', usersRouter()); // ADMIN-only user management
  app.use('/api/sites', sitesRouter()); // E01: GET open, POST/PATCH ADMIN
  app.use('/api/divisions', divisionsRouter());
  app.use('/api/org', orgRouter());
  app.use('/api/pillars', pillarsRouter()); // E04: GET open, POST/PATCH ADMIN
  app.use('/api/portfolios', portfoliosRouter()); // E04: POST/PATCH ADMIN or DIVISION_LEAD
  app.use('/api/programs', programsRouter());
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
