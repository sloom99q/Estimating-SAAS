import { useRef, useState } from 'react'
import { Alert, Button, Card, Group, Stack, Text } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import { useUploadProjectDocument } from '../api/useTakeoff'

interface UploadCardProps {
  projectId: string
  onUploaded?: (documentId: string) => void
}

export function UploadCard({ projectId, onUploaded }: UploadCardProps) {
  const { t } = useTranslation('takeoff')
  const inputRef = useRef<HTMLInputElement>(null)
  const mutation = useUploadProjectDocument(projectId)
  const [error, setError] = useState<string | null>(null)

  const handlePick = () => inputRef.current?.click()

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    try {
      const result = await mutation.mutateAsync(file)
      onUploaded?.(result.document.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // Reset input so picking the same file again triggers a new upload.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2}>
            <Text fw={600}>{t('upload.dropHere')}</Text>
            <Text size="xs" c="dimmed">{t('upload.help')}</Text>
          </Stack>
          <Button onClick={handlePick} loading={mutation.isPending}>
            {mutation.isPending ? t('upload.uploading') : t('upload.cta')}
          </Button>
        </Group>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={handleChange}
        />
        {error ? (
          <Alert color="red" variant="light">
            {t('errors.uploadFailed', { message: error })}
          </Alert>
        ) : null}
      </Stack>
    </Card>
  )
}
