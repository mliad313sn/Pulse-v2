import { Router } from 'express';
import { asyncHandler } from './middleware.js';
import { buildDeckData, buildExecutiveDeck } from '../reporter/deck.js';
import { validation } from '../errors.js';

const CONTENT_TYPES = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
};

/** GET /api/reports/executive-deck?format=pptx|pdf — binary download (SC5). */
export function reportsRouter() {
  const router = Router();
  router.get('/executive-deck', asyncHandler(async (req, res) => {
    const format = (req.query.format ?? 'pptx').toLowerCase();
    if (!CONTENT_TYPES[format]) {
      throw validation("format must be 'pptx' or 'pdf'", { allowed: ['pptx', 'pdf'] });
    }
    const data = await buildDeckData(req.app.locals.repo);
    const buffer = await buildExecutiveDeck(data, format);
    res
      .status(200)
      .set('Content-Type', CONTENT_TYPES[format])
      .set('Content-Disposition', `attachment; filename="opspm360-executive-deck.${format}"`)
      .set('Content-Length', String(buffer.length))
      .send(buffer);
  }));
  return router;
}
