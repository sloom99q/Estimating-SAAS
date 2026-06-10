import { env } from '@/shared/config/env'
import { httpRequest } from '@/shared/lib/http/client'
import { useSessionStore } from '@/shared/store/sessionStore'
import type { ID } from '@/shared/types'
import type {
  MaterialSupplierPrice,
  PatchPriceLinkInput,
  PriceSnapshot,
  SetPriceInput,
} from '../domain/price.types'

/**
 * Material-supplier price + snapshot transport. Unlike suppliers (which use
 * the standard `Repository` shape), prices are material-scoped — they live
 * underneath `/api/material-supplier-prices?materialId=…` and write a new
 * snapshot every time the price changes. We talk to them directly via
 * `httpRequest` instead of forcing the Repository abstraction to bend.
 *
 * When `VITE_API_URL` is empty (offline / tests), every call returns empty —
 * the localStorage fallback does not implement procurement.
 */

function token(): string | undefined {
  return useSessionStore.getState().session?.token ?? undefined
}

function authed<T>(path: string, init?: Omit<Parameters<typeof httpRequest>[1], 'token'>) {
  const t = token()
  return httpRequest<T>(path, { ...(init ?? {}), ...(t ? { token: t } : {}) })
}

export async function fetchPrices(materialId: ID): Promise<MaterialSupplierPrice[]> {
  if (!env.apiUrl) return []
  return authed<MaterialSupplierPrice[]>(
    `/api/material-supplier-prices?materialId=${encodeURIComponent(materialId)}`,
    { method: 'GET' },
  )
}

export async function fetchPriceHistory(
  materialId: ID,
  options: { supplierId?: ID; since?: string } = {},
): Promise<PriceSnapshot[]> {
  if (!env.apiUrl) return []
  const params = new URLSearchParams()
  params.set('materialId', materialId)
  if (options.supplierId) params.set('supplierId', options.supplierId)
  if (options.since) params.set('since', options.since)
  return authed<PriceSnapshot[]>(`/api/price-snapshots?${params.toString()}`, {
    method: 'GET',
  })
}

export async function setPrice(input: SetPriceInput): Promise<MaterialSupplierPrice> {
  if (!env.apiUrl) {
    throw new Error('Setting supplier prices requires a backend (VITE_API_URL).')
  }
  return authed<MaterialSupplierPrice>('/api/material-supplier-prices', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function patchPriceLink(
  linkId: ID,
  input: PatchPriceLinkInput,
): Promise<MaterialSupplierPrice> {
  if (!env.apiUrl) {
    throw new Error('Patching supplier prices requires a backend (VITE_API_URL).')
  }
  return authed<MaterialSupplierPrice>(
    `/api/material-supplier-prices/${encodeURIComponent(linkId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  )
}

export async function deletePriceLink(linkId: ID): Promise<void> {
  if (!env.apiUrl) return
  await authed<null>(`/api/material-supplier-prices/${encodeURIComponent(linkId)}`, {
    method: 'DELETE',
  })
}
