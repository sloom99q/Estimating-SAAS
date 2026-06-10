import {
  Box,
  Button,
  SegmentedControl,
  Stack,
  Text,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { Cube, GridFour, ListBullets, Plus } from '@phosphor-icons/react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useMaterialsView, useUiStore } from '@/shared/store/uiStore'
import { DataCard, PageHeader } from '@/shared/ui'
import { useCreateMaterial } from '../api/useCreateMaterial'
import { useDeleteMaterial } from '../api/useDeleteMaterial'
import { useMaterials } from '../api/useMaterials'
import { useUpdateMaterial } from '../api/useUpdateMaterial'
import { MaterialFormModal } from '../components/MaterialFormModal'
import { MaterialGallery } from '../components/MaterialGallery'
import { MaterialsTable } from '../components/MaterialsTable'
import { MaterialFinder } from '../components/MaterialFinder'
import {
  emptyFilterState,
  filterMaterials,
  toFiltersInput,
  type MaterialFilterState,
} from '../domain/discovery'
import type { Material } from '../domain/material.types'

export function MaterialsListPage() {
  const { t } = useTranslation(['materials'])
  const navigate = useNavigate()
  const view = useMaterialsView()
  const setMaterialsView = useUiStore((state) => state.setMaterialsView)

  const { data: materials, isLoading, isError } = useMaterials()
  const createMutation = useCreateMaterial()
  const updateMutation = useUpdateMaterial()
  const deleteMutation = useDeleteMaterial()

  const [formOpened, formModal] = useDisclosure(false)
  const [editing, setEditing] = useState<Material | undefined>(undefined)
  const [filters, setFilters] = useState<MaterialFilterState>(emptyFilterState)

  const visibleMaterials = useMemo(() => {
    if (!materials) return materials
    return filterMaterials(materials, toFiltersInput(filters))
  }, [materials, filters])

  const openCreate = () => {
    setEditing(undefined)
    formModal.open()
  }
  const openEdit = (material: Material) => {
    setEditing(material)
    formModal.open()
  }
  /**
   * Card / row click navigates to the material's procurement workspace
   * (Phase 8B). Kebab actions still open the edit form modal in place.
   */
  const openDetail = (material: Material) => {
    void navigate(`/materials/${material.id}`)
  }

  const handleSubmit = async (values: Parameters<typeof createMutation.mutate>[0]) => {
    if (editing) {
      await updateMutation.mutateAsync({ materialId: editing.id, input: values })
    } else {
      await createMutation.mutateAsync(values)
    }
    formModal.close()
  }

  const handleDelete = (material: Material) => {
    modals.openConfirmModal({
      title: t('materials:delete.title'),
      children: (
        <Text fz="sm" c="dimmed">
          {t('materials:delete.body', { name: material.name })}
        </Text>
      ),
      labels: {
        confirm: t('materials:delete.confirm'),
        cancel: t('materials:actions.cancel'),
      },
      confirmProps: { color: 'danger' },
      centered: true,
      onConfirm: () => {
        deleteMutation.mutate(material.id, {
          onError: () =>
            notifications.show({ color: 'red', message: t('materials:error') }),
          onSuccess: () => formModal.close(),
        })
      },
    })
  }

  const errorMessage =
    createMutation.error?.message ?? updateMutation.error?.message ?? undefined

  const hasMaterials = (materials?.length ?? 0) > 0

  return (
    <Stack gap="xl">
      <PageHeader
        title={t('materials:title')}
        description={t('materials:description')}
        actions={
          <>
            {hasMaterials ? (
              <SegmentedControl
                value={view}
                onChange={(value) =>
                  setMaterialsView(value === 'table' ? 'table' : 'gallery')
                }
                size="sm"
                data={[
                  {
                    value: 'gallery',
                    label: (
                      <ViewOption icon={<GridFour size={14} />} label={t('materials:view.gallery')} />
                    ),
                  },
                  {
                    value: 'table',
                    label: (
                      <ViewOption icon={<ListBullets size={14} />} label={t('materials:view.table')} />
                    ),
                  },
                ]}
              />
            ) : null}
            <Button leftSection={<Plus size={16} weight="bold" />} onClick={openCreate}>
              {t('materials:newMaterial')}
            </Button>
          </>
        }
      />

      {hasMaterials && materials ? (
        <MaterialFinder materials={materials} state={filters} onChange={setFilters} />
      ) : null}

      {view === 'gallery' && visibleMaterials && visibleMaterials.length > 0 ? (
        <MaterialGallery materials={visibleMaterials} onOpen={openDetail} />
      ) : (
        <DataCard
          isLoading={isLoading}
          isError={isError}
          isEmpty={!visibleMaterials || visibleMaterials.length === 0}
          errorTitle={t('materials:error')}
          emptyIcon={Cube}
          emptyTitle={t('materials:empty.title')}
          emptyDescription={t('materials:empty.description')}
          emptyAction={
            <Button
              mt="sm"
              leftSection={<Plus size={16} weight="bold" />}
              onClick={openCreate}
            >
              {t('materials:empty.cta')}
            </Button>
          }
        >
          {visibleMaterials ? (
            <MaterialsTable
              materials={visibleMaterials}
              onOpen={openDetail}
              onEdit={openEdit}
              onDelete={handleDelete}
            />
          ) : null}
        </DataCard>
      )}

      <MaterialFormModal
        opened={formOpened}
        onClose={formModal.close}
        material={editing}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        errorMessage={errorMessage}
      />
    </Stack>
  )
}

function ViewOption({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {icon}
      <span>{label}</span>
    </Box>
  )
}
