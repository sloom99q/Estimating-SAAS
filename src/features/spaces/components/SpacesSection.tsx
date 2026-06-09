import {
  Box,
  Button,
  SegmentedControl,
  Text,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { GridFour, ListBullets, Plus, RectangleDashed } from '@phosphor-icons/react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSpacesView, useUiStore } from '@/shared/store/uiStore'
import type { ID } from '@/shared/types'
import { DataCard, Section } from '@/shared/ui'
import { useCreateSpace } from '../api/useCreateSpace'
import { useDeleteSpace } from '../api/useDeleteSpace'
import { useSpaces } from '../api/useSpaces'
import { useUpdateSpace } from '../api/useUpdateSpace'
import type { Space } from '../domain/space.types'
import { SpaceFormModal } from './SpaceFormModal'
import { SpacesGrid, type SpaceSurfaceVisuals } from './SpacesGrid'
import { SpacesTable, type SpaceCostEntry } from './SpacesTable'

interface SpacesSectionProps {
  projectId: ID
  /** Optional editorial step prefix forwarded to the Section heading. */
  step?: string | undefined
  /**
   * Optional pre-computed per-space cost map. The composition layer (app/)
   * builds this from material-aware calculations; when omitted, the grid /
   * table falls back to Phase-2 default placeholder rates.
   */
  costsBySpaceId?: ReadonlyMap<ID, SpaceCostEntry> | undefined
  /** Optional callback that opens an "Assign materials" dialog for a space. */
  onAssignMaterials?: ((space: Space) => void) | undefined
  /** Optional per-space cost breakdown for the drill-down panel. */
  renderBreakdown?: ((space: Space) => ReactNode) | undefined
  /** Resolved per-space SurfaceVisuals — drives the mini plan and chips. */
  getSurfaceVisuals?: ((space: Space) => SpaceSurfaceVisuals) | undefined
}

/**
 * The "Spaces" composition for the project workspace: section header + view
 * toggle (cards / table) + add/edit modal + delete confirmation. The KPI row
 * that used to live here is now owned by the workspace's `ProjectCostHero`.
 */
export function SpacesSection({
  projectId,
  step,
  costsBySpaceId,
  onAssignMaterials,
  renderBreakdown,
  getSurfaceVisuals,
}: SpacesSectionProps) {
  const { t } = useTranslation(['spaces'])
  const view = useSpacesView()
  const setSpacesView = useUiStore((s) => s.setSpacesView)
  const { data: spaces, isLoading, isError } = useSpaces(projectId)
  const createMutation = useCreateSpace(projectId)
  const updateMutation = useUpdateSpace(projectId)
  const deleteMutation = useDeleteSpace(projectId)

  const [modalOpened, modal] = useDisclosure(false)
  const [editing, setEditing] = useState<Space | undefined>(undefined)

  const openCreate = () => {
    setEditing(undefined)
    modal.open()
  }
  const openEdit = (space: Space) => {
    setEditing(space)
    modal.open()
  }

  const handleSubmit = async (values: Parameters<typeof createMutation.mutate>[0]) => {
    if (editing) {
      await updateMutation.mutateAsync({ spaceId: editing.id, input: values })
    } else {
      await createMutation.mutateAsync(values)
    }
    modal.close()
  }

  const handleDelete = (space: Space) => {
    modals.openConfirmModal({
      title: t('spaces:delete.title'),
      children: (
        <Text fz="sm" c="dimmed">
          {t('spaces:delete.body', { name: space.name })}
        </Text>
      ),
      labels: {
        confirm: t('spaces:delete.confirm'),
        cancel: t('spaces:actions.cancel'),
      },
      confirmProps: { color: 'danger' },
      centered: true,
      onConfirm: () => {
        deleteMutation.mutate(space.id, {
          onError: () =>
            notifications.show({ color: 'red', message: t('spaces:delete.confirm') }),
        })
      },
    })
  }

  const errorMessage =
    createMutation.error?.message ?? updateMutation.error?.message ?? undefined

  const hasSpaces = Boolean(spaces && spaces.length > 0)

  return (
    <>
      <Section
        title={t('spaces:title')}
        description={t('spaces:description')}
        {...(step ? { step } : {})}
        actions={
          hasSpaces ? (
            <>
              <SegmentedControl
                value={view}
                onChange={(value) =>
                  setSpacesView(value === 'table' ? 'table' : 'cards')
                }
                size="sm"
                data={[
                  {
                    value: 'cards',
                    label: (
                      <ViewOption icon={<GridFour size={14} />} label={t('spaces:view.cards')} />
                    ),
                  },
                  {
                    value: 'table',
                    label: (
                      <ViewOption icon={<ListBullets size={14} />} label={t('spaces:view.table')} />
                    ),
                  },
                ]}
              />
              <Button
                variant="default"
                leftSection={<Plus size={16} weight="bold" />}
                onClick={openCreate}
              >
                {t('spaces:addSpace')}
              </Button>
            </>
          ) : null
        }
      >
        {view === 'cards' && hasSpaces && spaces ? (
          <SpacesGrid
            spaces={spaces}
            {...(costsBySpaceId ? { costsBySpaceId } : {})}
            {...(getSurfaceVisuals ? { getSurfaceVisuals } : {})}
            onEdit={openEdit}
            onDelete={handleDelete}
            {...(onAssignMaterials ? { onAssignMaterials } : {})}
            {...(renderBreakdown ? { renderBreakdown } : {})}
          />
        ) : (
          <DataCard
            isLoading={isLoading}
            isError={isError}
            isEmpty={!hasSpaces}
            emptyIcon={RectangleDashed}
            emptyTitle={t('spaces:empty.title')}
            emptyDescription={t('spaces:empty.description')}
            emptyAction={
              <Button
                mt="sm"
                leftSection={<Plus size={16} weight="bold" />}
                onClick={openCreate}
              >
                {t('spaces:empty.cta')}
              </Button>
            }
          >
            {spaces ? (
              <SpacesTable
                spaces={spaces}
                onEdit={openEdit}
                onDelete={handleDelete}
                {...(onAssignMaterials ? { onAssignMaterials } : {})}
                {...(costsBySpaceId ? { costsBySpaceId } : {})}
                {...(renderBreakdown ? { renderBreakdown } : {})}
              />
            ) : null}
          </DataCard>
        )}
      </Section>

      <SpaceFormModal
        opened={modalOpened}
        onClose={modal.close}
        space={editing}
        onSubmit={handleSubmit}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        errorMessage={errorMessage}
      />
    </>
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
