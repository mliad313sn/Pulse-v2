/**
 * E08 — Computed project progress (plan §23, invariant 15).
 *
 * There is NO stored/manual overall percentage anywhere. The wire field
 * `project.progress` is derived at read time:
 *
 *   percent = sum(weight of DONE active milestones)
 *           / sum(weight of non-CANCELLED milestones) * 100
 *
 * Behavior definitions (plan §23 asks these to be explicit):
 *   - cancelled milestones are excluded from BOTH numerator and denominator;
 *   - newly added milestones enter the denominator immediately (progress may drop);
 *   - no milestones at all      -> percent null, explanation "No milestones yet";
 *   - all milestones cancelled  -> percent null (never divide by zero);
 *   - missing/invalid weight    -> treated as the default weight 1.
 *
 * The `explanation` string satisfies invariant 25 (every derived metric is
 * explainable from source data) and feeds the progress UI's numerator/
 * denominator display.
 *
 * Pure and unit-testable; identical for MemoryRepo and Postgres reads.
 */

const weightOf = (m) => (Number.isInteger(m.weight) && m.weight >= 1 ? m.weight : 1);

/**
 * @param {Array<{status: string, weight?: number}>} milestones the project's milestones
 * @returns {{percent: number|null, completedWeight: number, activeWeight: number, explanation: string}}
 */
export function computeProgress(milestones = []) {
  if (milestones.length === 0) {
    return { percent: null, completedWeight: 0, activeWeight: 0, explanation: 'No milestones yet' };
  }

  const active = milestones.filter((m) => m.status !== 'CANCELLED');
  const cancelled = milestones.length - active.length;
  const done = active.filter((m) => m.status === 'DONE');
  const activeWeight = active.reduce((sum, m) => sum + weightOf(m), 0);
  const completedWeight = done.reduce((sum, m) => sum + weightOf(m), 0);

  if (activeWeight === 0) {
    return {
      percent: null,
      completedWeight: 0,
      activeWeight: 0,
      explanation: `No active milestones (${cancelled} cancelled excluded)`,
    };
  }

  return {
    percent: Math.round((completedWeight / activeWeight) * 100),
    completedWeight,
    activeWeight,
    explanation:
      `${completedWeight} of ${activeWeight} weighted milestone points complete `
      + `(${done.length}/${active.length} active milestones DONE`
      + `${cancelled ? `; ${cancelled} cancelled excluded` : ''})`,
  };
}
