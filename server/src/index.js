import { createApp } from './app.js';
import { MemoryRepo } from './repo/memoryRepo.js';

const port = Number(process.env.PORT ?? 4000);

let repo;
if (process.env.DATABASE_URL) {
  const { PgRepo } = await import('./repo/pgRepo.js');
  repo = new PgRepo(process.env.DATABASE_URL);
  console.log('[opspm360] repository: PostgreSQL (DATABASE_URL set)');
} else {
  repo = new MemoryRepo();
  console.log('[opspm360] repository: in-memory with demo seed (set DATABASE_URL to use PostgreSQL)');
}

const app = createApp({ repo });
app.listen(port, () => {
  console.log(`[opspm360] API listening on http://localhost:${port}/api (docs at /api/docs)`);
});
