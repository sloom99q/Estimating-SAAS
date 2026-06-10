export { SuppliersListPage } from './pages/SuppliersListPage'
export { SupplierCard } from './components/SupplierCard'
export { SupplierFormModal } from './components/SupplierFormModal'
export { PriceComparisonBars } from './components/PriceComparisonBars'
export { PriceTimelineChart } from './components/PriceTimelineChart'
export { AddPriceModal } from './components/AddPriceModal'
export { MaterialProcurementPanel } from './components/MaterialProcurementPanel'
export { useSuppliers } from './api/useSuppliers'
export { useMaterialPrices, useMaterialPriceHistory, useMaterialProcurement } from './api/usePrices'
export type { Supplier, SupplierInput } from './domain/supplier.types'
export type {
  MaterialSupplierPrice,
  PriceSnapshot,
  SetPriceInput,
  PatchPriceLinkInput,
} from './domain/price.types'
export {
  pickCheapestPrice,
  pickPreferredPrice,
  savingsVsPreferred,
  computeTrend,
  snapshotsBySupplier,
  summariseProcurement,
} from './domain/procurement'
export type {
  TrendDirection,
  PriceTrend,
  ProcurementSummary,
} from './domain/procurement'
