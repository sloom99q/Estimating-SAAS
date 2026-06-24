import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Group, List, Loader, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { dxfModalActions } from '@/shared/store/dxfModalStore'
import { useUploadProjectDocument } from '../api/useTakeoff'

interface UploadCardProps {
  projectId: string
  onUploaded?: (documentId: string) => void
}

interface UploadEntry {
  name: string
  state: 'queued' | 'uploading' | 'done' | 'error'
  error?: string
  documentId?: string
}

/**
 * MULTI-DOC #1 (2026-06-21) — multi-file upload. Real drawing sets
 * are 20-50 files (architect's PDF + revisions + MEP + structural +
 * schedule pack). The native <input multiple> picker lets the user
 * select N at once; we POST them serially so the existing
 * useUploadProjectDocument flow + INGEST chain stays unchanged
 * per-file. Drag-and-drop also handled.
 *
 * Each file is uploaded individually, with per-file state shown in
 * the queue. DocumentsListCard (below this in TakeoffPage) is the
 * authoritative status surface for what happens AFTER upload — this
 * card just covers the upload moment itself.
 */
export function UploadCard({ projectId, onUploaded }: UploadCardProps) {
  const { t } = useTranslation('takeoff')
  const inputRef = useRef<HTMLInputElement>(null)
  const mutation = useUploadProjectDocument(projectId)
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<UploadEntry[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // P1 — fire the browser's "are you sure?" dialog ONLY while an
  // upload POST is in flight. Once the server has the bytes (mutation
  // resolved), extraction continues on the server and the user can
  // safely navigate away or close the tab.
  useEffect(() => {
    if (!isUploading) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isUploading])

  const handlePick = () => inputRef.current?.click()

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return
    setError(null)
    const entries: UploadEntry[] = files.map((f) => ({ name: f.name, state: 'queued' }))
    setQueue((prev) => [...prev, ...entries])
    setIsUploading(true)
    try {
      const offset = queue.length
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i]!
        const idx = offset + i
        setQueue((prev) => prev.map((e, j) => (j === idx ? { ...e, state: 'uploading' } : e)))
        try {
          const result = await mutation.mutateAsync(file)
          setQueue((prev) =>
            prev.map((e, j) =>
              j === idx ? { ...e, state: 'done', documentId: result.document.id } : e,
            ),
          )
          onUploaded?.(result.document.id)
          // DXF MVP — DXF uploads don't auto-chain INGEST. They need
          // the LayerMapModal so the estimator confirms which DXF
          // layer holds rooms/doors/windows before PARSE_DXF can run.
          // Fire the open signal on the shared store; the app shell
          // mounts the modal.
          const isDxf =
            (result.document as { sourceFormat?: string }).sourceFormat === 'DXF'
          if (isDxf) {
            dxfModalActions.open({
              projectId,
              documentId: result.document.id,
              filename: file.name,
            })
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          setQueue((prev) =>
            prev.map((e, j) => (j === idx ? { ...e, state: 'error', error: msg } : e)),
          )
          // Keep going through the rest of the queue; one bad file
          // shouldn't block the others.
        }
      }
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    await uploadFiles(files)
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    // Accept PDFs and DXFs — the server's magic-byte sniff + size cap
    // is the authoritative gate; this filter just keeps obvious
    // garbage (folders, images) out of the queue UI.
    const files = Array.from(e.dataTransfer.files ?? []).filter(
      (f) =>
        f.type === 'application/pdf' ||
        /\.pdf$/i.test(f.name) ||
        /\.dxf$/i.test(f.name),
    )
    await uploadFiles(files)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(true)
  }
  const handleDragLeave = () => setDragOver(false)

  const doneCount = queue.filter((q) => q.state === 'done').length
  const errorCount = queue.filter((q) => q.state === 'error').length

  return (
    <Card
      withBorder
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        background: dragOver ? 'var(--mantine-color-blue-0)' : undefined,
        borderColor: dragOver ? 'var(--mantine-color-blue-5)' : undefined,
      }}
    >
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={600}>{t('upload.dropHere')}</Text>
            <Text size="xs" c="dimmed">
              {t('upload.help')}
              {' · '}
              Drop PDFs or DXFs at once, or use the button to pick a batch. PDFs go through the
              vision pipeline; DXFs open a one-time layer-map confirm modal per project, then
              parse instantly with exact areas.
            </Text>
          </Stack>
          <Button onClick={handlePick} loading={isUploading}>
            {isUploading ? t('upload.uploading') : t('upload.cta')}
          </Button>
        </Group>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf,.dxf,application/dxf"
          multiple
          style={{ display: 'none' }}
          onChange={handleChange}
        />
        {queue.length > 0 ? (
          <Stack gap={4}>
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                Upload queue ({queue.length})
              </Text>
              {doneCount > 0 ? (
                <Badge size="xs" color="green" variant="light">
                  {doneCount} uploaded
                </Badge>
              ) : null}
              {errorCount > 0 ? (
                <Badge size="xs" color="red" variant="light">
                  {errorCount} failed
                </Badge>
              ) : null}
            </Group>
            <List size="xs" spacing={2}>
              {queue.map((q, i) => (
                <List.Item
                  key={`${q.name}-${i}`}
                  icon={
                    q.state === 'uploading' ? (
                      <Loader size={10} />
                    ) : q.state === 'done' ? (
                      <Text component="span" size="xs" c="green">
                        ✓
                      </Text>
                    ) : q.state === 'error' ? (
                      <Text component="span" size="xs" c="red">
                        ✕
                      </Text>
                    ) : (
                      <Text component="span" size="xs" c="dimmed">
                        ·
                      </Text>
                    )
                  }
                >
                  {q.state === 'error' ? (
                    <Text size="xs" c="red">
                      {q.name}
                      {q.error ? ` — ${q.error}` : ''}
                    </Text>
                  ) : (
                    <Text size="xs">{q.name}</Text>
                  )}
                </List.Item>
              ))}
            </List>
          </Stack>
        ) : null}
        {error ? (
          <Alert color="red" variant="light">
            {t('errors.uploadFailed', { message: error })}
          </Alert>
        ) : null}
      </Stack>
    </Card>
  )
}
