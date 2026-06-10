import {
  Box,
  Button,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { Buildings, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataCard, PageHeader } from '@/shared/ui'
import { useCreateSupplier } from '../api/useCreateSupplier'
import { useDeleteSupplier } from '../api/useDeleteSupplier'
import { useSuppliers } from '../api/useSuppliers'
import { useUpdateSupplier } from '../api/useUpdateSupplier'
import { SupplierCard } from '../components/SupplierCard'
import { SupplierFormModal } from '../components/SupplierFormModal'
import type { SupplierFormValues } from '../domain/supplier.schema'
import type { Supplier } from '../domain/supplier.types'

/**
 * Supplier directory. Cards-only — no table view. Preferred suppliers float
 * to the top (server already orders this way); the search input + preferred
 * toggle filter in place.
 */
export function SuppliersListPage() {
  const { t } = useTranslation(['suppliers'])
  const { data: suppliers, isLoading, isError } = useSuppliers()
  const createMutation = useCreateSupplier()
  const updateMutation = useUpdateSupplier()
  const deleteMutation = useDeleteSupplier()

  const [formOpened, formModal] = useDisclosure(false)
  const [editing, setEditing] = useState<Supplier | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [showPreferredOnly, setShowPreferredOnly] = useState(false)

  const openCreate = () => {
    setEditing(undefined)
    formModal.open()
  }
  const openEdit = (supplier: Supplier) => {
    setEditing(supplier)
    formModal.open()
  }

  const visible = useMemo(() => {
    if (!suppliers) return suppliers
    const haystack = query.trim().toLowerCase()
    return suppliers.filter((supplier) => {
      if (showPreferredOnly && !supplier.preferred) return false
      if (haystack.length === 0) return true
      const combined = [
        supplier.name,
        supplier.country ?? '',
        supplier.contactName ?? '',
        supplier.notes ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return combined.includes(haystack)
    })
  }, [suppliers, query, showPreferredOnly])

  const handleSubmit = async (values: SupplierFormValues) => {
    if (editing) {
      await updateMutation.mutateAsync({ supplierId: editing.id, input: values })
    } else {
      await createMutation.mutateAsync(values)
    }
    formModal.close()
  }

  const handleDelete = (supplier: Supplier) => {
    modals.openConfirmModal({
      title: t('suppliers:delete.title'),
      children: (
        <Text fz="sm" c="dimmed">
          {t('suppliers:delete.body', { name: supplier.name })}
        </Text>
      ),
      labels: {
        confirm: t('suppliers:delete.confirm'),
        cancel: t('suppliers:actions.cancel'),
      },
      confirmProps: { color: 'danger' },
      centered: true,
      onConfirm: () => {
        deleteMutation.mutate(supplier.id, {
          onSuccess: () => formModal.close(),
          onError: () =>
            notifications.show({ color: 'red', message: t('suppliers:error.delete') }),
        })
      },
    })
  }

  const errorMessage =
    createMutation.error?.message ?? updateMutation.error?.message ?? undefined

  const hasSuppliers = (suppliers?.length ?? 0) > 0
  const preferredCount = useMemo(
    () => (suppliers ? suppliers.filter((s) => s.preferred).length : 0),
    [suppliers],
  )

  return (
    <Stack gap="xl">
      <PageHeader
        title={t('suppliers:title')}
        description={t('suppliers:description')}
        actions={
          <Button leftSection={<Plus size={16} weight="bold" />} onClick={openCreate}>
            {t('suppliers:newSupplier')}
          </Button>
        }
      />

      {hasSuppliers ? (
        <Stack gap="md">
          <TextInput
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('suppliers:list.searchPlaceholder')}
            leftSection={<MagnifyingGlass size={14} />}
          />
          <Box style={{ overflowX: 'auto' }}>
            <SimpleGrid cols={2} spacing={8}>
              <UnstyledButton
                onClick={() => setShowPreferredOnly(false)}
                style={chipStyle(!showPreferredOnly)}
              >
                <Text fz="sm" fw={500}>
                  {t('suppliers:list.allChip', { count: suppliers?.length ?? 0 })}
                </Text>
              </UnstyledButton>
              <UnstyledButton
                onClick={() => setShowPreferredOnly(true)}
                style={chipStyle(showPreferredOnly)}
              >
                <Text fz="sm" fw={500}>
                  {t('suppliers:list.preferredChip', { count: preferredCount })}
                </Text>
              </UnstyledButton>
            </SimpleGrid>
          </Box>
        </Stack>
      ) : null}

      {isLoading || isError || !visible || visible.length === 0 ? (
        <DataCard
          isLoading={isLoading}
          isError={isError}
          isEmpty={!visible || visible.length === 0}
          errorTitle={t('suppliers:error.list')}
          emptyIcon={Buildings}
          emptyTitle={t('suppliers:empty.title')}
          emptyDescription={t('suppliers:empty.description')}
          emptyAction={
            <Button
              mt="sm"
              leftSection={<Plus size={16} weight="bold" />}
              onClick={openCreate}
            >
              {t('suppliers:empty.cta')}
            </Button>
          }
        >
          {null}
        </DataCard>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg" verticalSpacing="lg">
          {visible.map((supplier) => (
            <SupplierCard
              key={supplier.id}
              supplier={supplier}
              onClick={openEdit}
            />
          ))}
        </SimpleGrid>
      )}

      <SupplierFormModal
        opened={formOpened}
        onClose={formModal.close}
        supplier={editing}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        errorMessage={errorMessage}
      />

      {/* Editing state has its own destructive action — rendered as a small
          subtle button beneath the modal trigger so a careless click can't
          submit the form. Mantine's confirm modal handles the safety net. */}
      {editing && formOpened ? (
        <Box pos="fixed" bottom={20} right={20} style={{ zIndex: 2000 }}>
          <Button
            variant="subtle"
            color="danger"
            size="xs"
            onClick={() => handleDelete(editing)}
          >
            {t('suppliers:delete.confirm')}
          </Button>
        </Box>
      ) : null}
    </Stack>
  )
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 12px',
    borderRadius: 'var(--mantine-radius-md)',
    background: active ? 'var(--mantine-color-text)' : 'var(--app-surface)',
    color: active ? 'var(--mantine-color-body)' : 'var(--mantine-color-text)',
    border: '1px solid',
    borderColor: active ? 'var(--mantine-color-text)' : 'var(--app-border)',
    textAlign: 'center',
  }
}
