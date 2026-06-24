/**
 * DXF MVP — app-level preview page for the LayerMapModal.
 *
 * Lives in app/ so it can compose features/ — features can't import
 * each other but the app shell can wire them together. Mounted at
 * /dxf/preview/:projectId/:documentId so the estimator (or this
 * agent) can land directly on the modal against a real uploaded
 * DXF for sign-off, before the UploadCard auto-trigger wiring lands.
 *
 * After estimator sign-off, the same modal will be mounted from a
 * shared signal store the UploadCard fires into.
 */
import { useState } from 'react'
import { Button, Card, Stack, Text, Title } from '@mantine/core'
import { useParams } from 'react-router'
import { LayerMapModal } from '@/features/dxf'

export function DxfLayerMapPreviewPage() {
  const { projectId = '', documentId = '' } = useParams<{
    projectId: string
    documentId: string
  }>()
  const [opened, setOpened] = useState(true)
  return (
    <Stack gap="md" p="lg">
      <Title order={2}>DXF layer-map preview</Title>
      <Text c="dimmed" size="sm">
        Project: <code>{projectId}</code> · Document: <code>{documentId}</code>
      </Text>
      <Card withBorder>
        <Stack gap="sm">
          <Text>
            This page is the sign-off surface for the LayerMapModal UX. The modal
            opens automatically; close + re-open to iterate.
          </Text>
          <Button onClick={() => setOpened(true)} disabled={opened}>
            Re-open modal
          </Button>
        </Stack>
      </Card>
      <LayerMapModal
        opened={opened}
        onClose={() => setOpened(false)}
        projectId={projectId}
        documentId={documentId}
        filename="(from URL)"
      />
    </Stack>
  )
}
