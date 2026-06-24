import { create } from 'zustand'

/**
 * DXF MVP — cross-feature signal for opening the LayerMapModal.
 *
 * Lives in `shared/` because the trigger (UploadCard in features/takeoff)
 * and the consumer (LayerMapModal in features/dxf) cannot import each
 * other under the architecture rule (`features/* must not import other
 * features`). The store is the meeting place, and `app/shell` mounts the
 * modal against this store.
 *
 * Why a store and not a route param: the modal opens IMMEDIATELY after a
 * DXF upload completes — no navigation, no URL change. The user stays on
 * the takeoff page, picks the layer map, the modal closes, PARSE_DXF
 * enqueues, the existing pipeline-status polling takes over.
 */
interface DxfModalState {
  opened: boolean
  projectId: string
  documentId: string
  filename: string
  /** UploadCard calls this on a successful .dxf upload with needsLayerMap. */
  open: (args: { projectId: string; documentId: string; filename: string }) => void
  /** LayerMapModal calls this on Save or Cancel. */
  close: () => void
}

export const useDxfModalStore = create<DxfModalState>((set) => ({
  opened: false,
  projectId: '',
  documentId: '',
  filename: '',
  open: ({ projectId, documentId, filename }) =>
    set({ opened: true, projectId, documentId, filename }),
  close: () => set({ opened: false }),
}))

/**
 * Imperative accessor for the upload flow — UploadCard can't subscribe
 * to the store with a hook from inside an async upload loop, so it pulls
 * the current setter directly.
 */
export const dxfModalActions = {
  open: (args: { projectId: string; documentId: string; filename: string }) =>
    useDxfModalStore.getState().open(args),
  close: () => useDxfModalStore.getState().close(),
}
