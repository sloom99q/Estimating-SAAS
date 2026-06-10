import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/shared/lib/query/queryKeys'
import { useCurrentUser } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import type {
  MaterialSupplierPrice,
  PatchPriceLinkInput,
  PriceSnapshot,
  SetPriceInput,
} from '../domain/price.types'
import {
  deletePriceLink,
  fetchPriceHistory,
  fetchPrices,
  patchPriceLink,
  setPrice,
} from './prices.service'

/**
 * Live supplier prices for a single material — the input the comparison
 * panel renders. Re-fetched whenever a price write succeeds.
 */
export function useMaterialPrices(materialId: ID | undefined) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  return useQuery({
    queryKey: queryKeys.prices.forMaterial(organizationId, materialId ?? ''),
    queryFn: () => fetchPrices(materialId ?? ''),
    enabled: organizationId !== '' && Boolean(materialId),
  })
}

/**
 * Immutable price history for a material (optionally narrowed to one
 * supplier). Feeds the timeline chart + trend detection.
 */
export function useMaterialPriceHistory(
  materialId: ID | undefined,
  options: { supplierId?: ID } = {},
) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const params: Record<string, unknown> = options.supplierId
    ? { supplierId: options.supplierId }
    : {}
  return useQuery({
    queryKey: queryKeys.priceHistory.forMaterial(organizationId, materialId ?? '', params),
    queryFn: () =>
      fetchPriceHistory(materialId ?? '', options.supplierId ? { supplierId: options.supplierId } : {}),
    enabled: organizationId !== '' && Boolean(materialId),
  })
}

function invalidateMaterialProcurement(qc: ReturnType<typeof useQueryClient>, orgId: ID, materialId: ID) {
  void qc.invalidateQueries({ queryKey: queryKeys.prices.forMaterial(orgId, materialId) })
  void qc.invalidateQueries({
    queryKey: ['org', orgId, 'materials', 'detail', materialId, 'price-history'] as const,
    exact: false,
  })
}

export function useSetPrice(materialId: ID) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<MaterialSupplierPrice, Error, SetPriceInput>({
    mutationFn: (input) => setPrice(input),
    onSuccess: () => invalidateMaterialProcurement(qc, organizationId, materialId),
  })
}

export function usePatchPriceLink(materialId: ID) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<MaterialSupplierPrice, Error, { linkId: ID; input: PatchPriceLinkInput }>({
    mutationFn: ({ linkId, input }) => patchPriceLink(linkId, input),
    onSuccess: () => invalidateMaterialProcurement(qc, organizationId, materialId),
  })
}

export function useDeletePriceLink(materialId: ID) {
  const currentUser = useCurrentUser()
  const organizationId = currentUser?.organizationId ?? ''
  const qc = useQueryClient()

  return useMutation<void, Error, ID>({
    mutationFn: (linkId) => deletePriceLink(linkId),
    onSuccess: () => invalidateMaterialProcurement(qc, organizationId, materialId),
  })
}

/**
 * Combined hook: live prices + history in one bundle. The composition page
 * calls this once per material; the underlying React Query hooks dedupe so
 * the network footprint is two fetches, not eight.
 */
export interface MaterialProcurementBundle {
  prices: MaterialSupplierPrice[]
  snapshots: PriceSnapshot[]
  isLoading: boolean
  isError: boolean
}

export function useMaterialProcurement(
  materialId: ID | undefined,
): MaterialProcurementBundle {
  const pricesQ = useMaterialPrices(materialId)
  const historyQ = useMaterialPriceHistory(materialId)
  return {
    prices: pricesQ.data ?? [],
    snapshots: historyQ.data ?? [],
    isLoading: pricesQ.isLoading || historyQ.isLoading,
    isError: pricesQ.isError || historyQ.isError,
  }
}
