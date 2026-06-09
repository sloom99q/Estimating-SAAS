import type { Money } from '@/shared/types'

export interface DashboardStats {
  activeProjects: number
  openEstimates: number
  pipelineValue: Money
  /** Win rate as a fraction in [0, 1]. */
  winRate: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Mock dashboard KPIs. Real backend slots in here against the http client. */
export async function fetchDashboardStats(_organizationId: string): Promise<DashboardStats> {
  await delay(300)
  return {
    activeProjects: 12,
    openEstimates: 7,
    pipelineValue: { amount: '482500.00', currency: 'AED' },
    winRate: 0.62,
  }
}
