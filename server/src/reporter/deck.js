/**
 * AGENT_REPORTER — Executive deck extraction (SC5).
 * Groups active projects by division with status, security gate flag, open
 * roadblocks (top blockers) and next actions; renders PPTX (pptxgenjs) or
 * PDF (pdfkit) with zero manual formatting.
 */
import PptxGenJS from 'pptxgenjs';
import PDFDocument from 'pdfkit';
import { computeLocked } from '../services/gates.js';
import { computeProgress } from '../services/progress.js';
import { filterReadableProjects } from '../services/policy.js';
import { groupMembers } from '../routes/helpers.js';

const ACTIVE_STATUSES = ['active', 'at_risk', 'on_hold'];
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 };

const STATUS_LABEL = {
  draft: 'Draft', active: 'Active', at_risk: 'At Risk', on_hold: 'On Hold', complete: 'Complete',
  todo: 'To Do', in_progress: 'In Progress', blocked: 'Blocked', done: 'Done',
};
const GATE_LABEL = {
  not_required: 'No gate', pending: 'InfoSec PENDING', approved: 'InfoSec approved', rejected: 'InfoSec REJECTED',
};

function groupByProject(rows) {
  const byProject = new Map();
  for (const row of rows) {
    const group = byProject.get(row.projectId);
    if (group) group.push(row);
    else byProject.set(row.projectId, [row]);
  }
  return byProject;
}

/**
 * The next open milestone: earliest due (forecast, falling back to baseline)
 * among not-DONE/not-CANCELLED milestones; undated ones sort last.
 */
function nextMilestone(milestones) {
  const open = milestones.filter((m) => m.status !== 'DONE' && m.status !== 'CANCELLED');
  if (open.length === 0) return null;
  const due = (m) => m.forecastDue ?? m.baselineDue ?? '9999-12-31';
  const next = [...open].sort((a, b) => due(a).localeCompare(due(b)))[0];
  return {
    id: next.id,
    title: next.title,
    type: next.type,
    status: next.status,
    due: next.forecastDue ?? next.baselineDue ?? null,
  };
}

/**
 * Collects and groups everything the deck needs. Pure data, testable.
 * `forUser` is the REQUESTING user: projects concealed from them (ADR-005
 * classification) are excluded from the deck — and so are their tasks and
 * roadblocks, because everything below is grouped under the project.
 */
export async function buildDeckData(repo, forUser) {
  const [allDivisions, allProjects, allMembers, tasks, roadblocks, milestones] = await Promise.all([
    repo.listDivisions(),
    repo.list('project'),
    repo.listProjectMembers(),
    repo.list('task'),
    repo.list('roadblock'),
    repo.list('milestone'),
  ]);
  // Membership-based classification + enterprise access (E04/E01).
  const membersByProject = groupMembers(allMembers);
  const projects = filterReadableProjects(forUser, allProjects, membersByProject);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const tasksByProject = groupByProject(tasks);
  const roadblocksByProject = groupByProject(roadblocks);
  const milestonesByProject = groupByProject(milestones);

  const divisions = [];
  for (const div of allDivisions) {
    const divProjects = projects.filter(
      (p) => p.division === div.code && ACTIVE_STATUSES.includes(p.overallStatus),
    );
    if (divProjects.length === 0) continue;

    divisions.push({
      code: div.code,
      name: div.name,
      projects: divProjects.map((p) => {
        const open = (roadblocksByProject.get(p.id) ?? [])
          .filter((r) => r.status !== 'resolved')
          .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
        const nextActions = (tasksByProject.get(p.id) ?? [])
          .filter((t) => t.status !== 'done')
          .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
          .slice(0, 3)
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            locked: computeLocked(t, tasksById, p),
          }));
        const projectMilestones = milestonesByProject.get(p.id) ?? [];
        return {
          id: p.id,
          name: p.name,
          site: p.site,
          overallStatus: p.overallStatus,
          securityGateStatus: p.securityGateStatus,
          // E08: computed progress + the next open milestone (E05 gates surface
          // GO_LIVE/readiness milestones through here for the exec view).
          progress: computeProgress(projectMilestones),
          nextMilestone: nextMilestone(projectMilestones),
          openRoadblockCount: open.length,
          blockers: open.slice(0, 3).map((r) => ({
            id: r.id, description: r.description, severity: r.severity, status: r.status,
          })),
          nextActions,
        };
      }),
    });
  }

  return { title: 'OpsPM360 Executive Review', generatedAt: new Date().toISOString(), divisions };
}

/** @returns {Promise<Buffer>} */
export async function buildExecutiveDeck(data, format = 'pptx') {
  if (format === 'pptx') return buildPptx(data);
  if (format === 'pdf') return buildPdf(data);
  throw new Error(`Unsupported deck format: ${format}`);
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------
const INK = '1F2937';
const ACCENT = '0F62FE';
const MUTED = '6B7280';
const STATUS_COLOR = { active: '15803D', at_risk: 'B45309', on_hold: '6B7280' };

async function buildPptx(data) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.author = 'OpsPM360';
  pptx.title = data.title;

  const dateStr = new Date(data.generatedAt).toUTCString();

  // Title slide
  const title = pptx.addSlide();
  title.background = { color: 'F4F6FA' };
  title.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.35, fill: { color: ACCENT } });
  title.addText(data.title, {
    x: 0.8, y: 2.4, w: 11.7, h: 1.2, fontSize: 40, bold: true, color: INK, fontFace: 'Arial',
  });
  title.addText(`Portfolio status, blockers and next actions — generated ${dateStr}`, {
    x: 0.8, y: 3.6, w: 11.7, h: 0.6, fontSize: 16, color: MUTED, fontFace: 'Arial',
  });
  title.addText('Auto-extracted by OpsPM360 — no manual formatting', {
    x: 0.8, y: 6.7, w: 11.7, h: 0.4, fontSize: 11, italic: true, color: MUTED, fontFace: 'Arial',
  });

  // One slide per division with active projects
  for (const div of data.divisions) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.35, fill: { color: ACCENT } });
    slide.addText(`${div.name} — Active Projects`, {
      x: 0.6, y: 0.55, w: 12.1, h: 0.7, fontSize: 26, bold: true, color: INK, fontFace: 'Arial',
    });

    const header = ['Project', 'Status', 'Security Gate', 'Open Roadblocks / Top Blockers', 'Next Actions'].map(
      (t) => ({ text: t, options: { bold: true, color: 'FFFFFF', fill: { color: INK }, fontSize: 12 } }),
    );
    const rows = [header];
    for (const p of div.projects) {
      const blockers = p.blockers.length
        ? p.blockers.map((b) => `• [${b.severity.toUpperCase()}] ${b.description}`).join('\n')
        : '• None reported';
      const actions = p.nextActions.length
        ? p.nextActions
            .map((t) => `• ${t.title} (${STATUS_LABEL[t.status] ?? t.status}${t.locked ? ' — LOCKED' : ''})`)
            .join('\n')
        : '• All tasks complete';
      rows.push([
        { text: `${p.name}${p.site ? `\n${p.site}` : ''}`, options: { fontSize: 12, bold: true, color: INK } },
        {
          text: STATUS_LABEL[p.overallStatus] ?? p.overallStatus,
          options: { fontSize: 12, bold: true, color: STATUS_COLOR[p.overallStatus] ?? INK, align: 'center' },
        },
        {
          text: GATE_LABEL[p.securityGateStatus] ?? p.securityGateStatus,
          options: {
            fontSize: 11,
            color: p.securityGateStatus === 'pending' ? 'B91C1C' : p.securityGateStatus === 'rejected' ? 'B91C1C' : '15803D',
            align: 'center',
          },
        },
        { text: `${p.openRoadblockCount} open\n${blockers}`, options: { fontSize: 11, color: INK } },
        { text: actions, options: { fontSize: 11, color: INK } },
      ]);
    }

    slide.addTable(rows, {
      x: 0.6, y: 1.5, w: 12.1,
      colW: [2.7, 1.2, 1.6, 3.5, 3.1],
      border: { type: 'solid', color: 'D1D5DB', pt: 0.75 },
      valign: 'top',
      rowH: 0.5,
      autoPage: true,
      fontFace: 'Arial',
    });

    slide.addText(`OpsPM360 · ${dateStr}`, {
      x: 0.6, y: 7.05, w: 12.1, h: 0.35, fontSize: 9, color: MUTED, align: 'right', fontFace: 'Arial',
    });
  }

  // Governance summary slide
  const gov = pptx.addSlide();
  gov.background = { color: 'FFFFFF' };
  gov.addShape('rect', { x: 0, y: 0, w: 13.33, h: 0.35, fill: { color: ACCENT } });
  gov.addText('Governance & Security Gates', {
    x: 0.6, y: 0.55, w: 12.1, h: 0.7, fontSize: 26, bold: true, color: INK, fontFace: 'Arial',
  });
  const gated = data.divisions
    .flatMap((d) => d.projects)
    .filter((p) => p.securityGateStatus !== 'not_required');
  const govLines = gated.length
    ? gated.map((p) => ({
        text: `${p.name}: ${GATE_LABEL[p.securityGateStatus]}`,
        options: { fontSize: 16, color: INK, bullet: true, breakLine: true },
      }))
    : [{ text: 'No projects currently under InfoSec review.', options: { fontSize: 16, color: MUTED } }];
  gov.addText(govLines, { x: 0.9, y: 1.6, w: 11.5, h: 4.5, valign: 'top', fontFace: 'Arial' });

  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------
function buildPdf(data) {
  return new Promise((resolve, reject) => {
    // compress:false keeps content streams plaintext so exports stay
    // text-auditable (classification leak scans assert on raw bytes).
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 48, compress: false });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const dateStr = new Date(data.generatedAt).toUTCString();

    // Title page
    doc.rect(0, 0, doc.page.width, 18).fill('#0F62FE');
    doc.fill('#1F2937').font('Helvetica-Bold').fontSize(32).text(data.title, 48, 180);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(13).fillColor('#6B7280')
      .text(`Portfolio status, blockers and next actions — generated ${dateStr}`);
    doc.fontSize(10).text('Auto-extracted by OpsPM360 — no manual formatting', 48, doc.page.height - 72);

    for (const div of data.divisions) {
      doc.addPage();
      doc.rect(0, 0, doc.page.width, 18).fill('#0F62FE');
      doc.fill('#1F2937').font('Helvetica-Bold').fontSize(22)
        .text(`${div.name} — Active Projects`, 48, 42);
      doc.moveDown(0.8);

      for (const p of div.projects) {
        if (doc.y > doc.page.height - 160) doc.addPage();
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#1F2937')
          .text(`${p.name}${p.site ? `  ·  ${p.site}` : ''}`);
        doc.font('Helvetica').fontSize(11)
          .fillColor(p.overallStatus === 'at_risk' ? '#B45309' : '#15803D')
          .text(`Status: ${STATUS_LABEL[p.overallStatus] ?? p.overallStatus}`, { continued: true })
          .fillColor(p.securityGateStatus === 'pending' || p.securityGateStatus === 'rejected' ? '#B91C1C' : '#15803D')
          .text(`    Security gate: ${GATE_LABEL[p.securityGateStatus]}`);

        doc.fillColor('#1F2937').font('Helvetica-Bold').fontSize(11)
          .text(`Open roadblocks (${p.openRoadblockCount}):`);
        doc.font('Helvetica').fontSize(10.5).fillColor('#374151');
        if (p.blockers.length === 0) {
          doc.text('  - None reported');
        } else {
          for (const b of p.blockers) doc.text(`  - [${b.severity.toUpperCase()}] ${b.description}`);
        }

        doc.font('Helvetica-Bold').fontSize(11).fillColor('#1F2937').text('Next actions:');
        doc.font('Helvetica').fontSize(10.5).fillColor('#374151');
        if (p.nextActions.length === 0) {
          doc.text('  - All tasks complete');
        } else {
          for (const t of p.nextActions) {
            doc.text(`  - ${t.title} (${STATUS_LABEL[t.status] ?? t.status}${t.locked ? ' — LOCKED' : ''})`);
          }
        }
        doc.moveDown(0.8);
      }

      doc.fontSize(8.5).fillColor('#6B7280')
        .text(`OpsPM360 · ${dateStr}`, 48, doc.page.height - 60, { align: 'right' });
    }

    doc.end();
  });
}
