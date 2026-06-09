/**
 * Pure project-progress model. Maps the workspace journey
 *   `project → spaces → materials → quotation`
 * to a discrete `ProjectStep` + a derived `ProjectProgress` snapshot the UI
 * renders into a stepper. No react, no mantine, no data fetching — the
 * composition layer feeds it the inputs it already has.
 *
 * Step semantics:
 *   - `project`    Always considered done once the user is in the workspace.
 *   - `spaces`     Done when the project contains at least one space.
 *   - `materials`  Done when every surface across every space carries a
 *                  material assignment (i.e. `boq.fullyAssigned`).
 *   - `quotation`  Done when the user has reached the quotation document.
 *
 * The function never throws — feed it the inputs you have. Pure: the same
 * inputs always produce the same output.
 */

export const PROJECT_STEPS = ['project', 'spaces', 'materials', 'quotation'] as const
export type ProjectStep = (typeof PROJECT_STEPS)[number]

export interface ProjectProgressInput {
  hasProject: boolean
  spaceCount: number
  /** From `boq.fullyAssigned` when the project has at least one space. */
  fullyAssigned: boolean
  /** True when the user is currently viewing the quotation document. */
  onQuotation?: boolean
}

export interface ProjectStepStatus {
  step: ProjectStep
  status: 'done' | 'current' | 'upcoming'
}

export interface ProjectProgress {
  /** Per-step state in journey order. */
  steps: ProjectStepStatus[]
  /** The step the user is currently positioned on. */
  current: ProjectStep
  /** Done as a fraction in [0, 1]. */
  completion: number
}

export function projectProgress(input: ProjectProgressInput): ProjectProgress {
  const done: Record<ProjectStep, boolean> = {
    project: input.hasProject,
    spaces: input.spaceCount > 0,
    // "materials done" requires at least one space — otherwise the project is
    // still on the spaces step rather than mysteriously being "complete".
    materials: input.spaceCount > 0 && input.fullyAssigned,
    quotation: input.onQuotation === true,
  }

  // The current step is the FIRST not-done step in journey order, or the
  // last step if everything is done.
  let current: ProjectStep = 'project'
  for (const step of PROJECT_STEPS) {
    if (!done[step]) {
      current = step
      break
    }
    current = step
  }
  // If every step before the current one is done AND current isn't done
  // either, fall through to highlight it.

  const steps: ProjectStepStatus[] = PROJECT_STEPS.map((step) => ({
    step,
    status: done[step] ? 'done' : step === current ? 'current' : 'upcoming',
  }))

  const doneCount = PROJECT_STEPS.reduce(
    (count, step) => (done[step] ? count + 1 : count),
    0,
  )
  const completion = doneCount / PROJECT_STEPS.length

  return { steps, current, completion }
}
