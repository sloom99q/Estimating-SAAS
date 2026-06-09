export { SpacesSection } from './components/SpacesSection'
export { ProjectSummaryStats } from './components/ProjectSummaryStats'
export type { ProjectSummaryTotals } from './components/ProjectSummaryStats'
export type { SpaceCostEntry } from './components/SpacesTable'
export type { SpaceSurfaceVisuals } from './components/SpacesGrid'
export { calcMeasurements } from './domain/calc'
export { DEFAULT_RATES } from './config/rates'
export { useSpaces } from './api/useSpaces'
export { useUpdateSpaceMaterials } from './api/useUpdateSpaceMaterials'
export { deleteSpacesForProject } from './api/spaces.service'
export type {
  Space,
  SpaceInput,
  SpaceMaterialsInput,
  SpaceMeasurements,
} from './domain/space.types'
