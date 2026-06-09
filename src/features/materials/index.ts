export { MaterialsListPage } from './pages/MaterialsListPage'
export { AssignMaterialsModal } from './components/AssignMaterialsModal'
export type { MaterialAssignmentInput } from './components/AssignMaterialsModal'
export { BoqSummary } from './components/BoqSummary'
export { CategoryCompositionBar } from './components/CategoryCompositionBar'
export { ProjectCostHero } from './components/ProjectCostHero'
export { EstimateCompleteCard } from './components/EstimateCompleteCard'
export { SpaceCostBreakdownView } from './components/SpaceCostBreakdown'
export { toSurfaceVisual } from './components/surface-visual'
export { useMaterials } from './api/useMaterials'
export type { Material, MaterialCategory, MaterialUnit } from './domain/material.types'
export { calcSpaceCostBreakdown, calcSurfaceQuantity } from './domain/quantity'
export type {
  SpaceCostBreakdown,
  SurfaceCostLine,
  DefaultRates,
  SpaceAreas,
  SpaceMaterialAssignments,
} from './domain/quantity'
export { calcProjectBoq } from './domain/boq'
export type { ProjectBoq, BoqLine, BoqCategoryTotal, BoqSpaceInput } from './domain/boq'
