import { Center, Loader, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { FolderOpen, Warning } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useParams } from 'react-router'
import { paths } from '@/app/router/paths'
import {
  AssignMaterialsModal,
  BoqSummary,
  CategoryCompositionBar,
  EstimateCompleteCard,
  ProjectCostHero,
  SpaceCostBreakdownView,
  calcProjectBoq,
  toSurfaceVisual,
  useMaterials,
  type DefaultRates,
  type Material,
  type MaterialAssignmentInput,
} from '@/features/materials'
import {
  ProjectFlowStepper,
  ProjectFormModal,
  ProjectWorkspaceHeader,
  projectProgress,
  useDeleteProject,
  useProject,
  useUpdateProject,
  type ProjectStep,
} from '@/features/projects'
import {
  calcMeasurements,
  DEFAULT_RATES,
  deleteSpacesForProject,
  SpacesSection,
  useSpaces,
  useUpdateSpaceMaterials,
  type Space,
  type SpaceCostEntry,
  type SpaceSurfaceVisuals,
} from '@/features/spaces'
import type { ID } from '@/shared/types'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { EmptyState } from '@/shared/ui'

/**
 * Composition root for a single project. The join point for the three
 * features that the architecture rules forbid from importing each other
 * (projects, spaces, materials). Phase 6 turns this page from a "dashboard"
 * into an editorial flow:
 *
 *   1. Project header
 *   2. Cost HERO — the single dominant figure of the page
 *   3. Cost-composition bar — at-a-glance category split
 *   4. SECTION 01 — Spaces (cards by default)
 *   5. SECTION 02 — Bill of quantities (category accordion)
 *
 * The step numbers communicate progression without imposing a wizard.
 */
export function ProjectWorkspacePage() {
  const { t } = useTranslation(['projects'])
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const currentUser = useCurrentUser()

  const { data: project, isLoading, isError } = useProject(projectId)
  const { data: spaces } = useSpaces(projectId)
  const { data: materials } = useMaterials()
  const updateProjectMutation = useUpdateProject()
  const deleteProjectMutation = useDeleteProject()
  const assignMutation = useUpdateSpaceMaterials(projectId ?? '')

  const [editOpened, editModal] = useDisclosure(false)
  const [assignOpened, assignModal] = useDisclosure(false)
  const [assignTarget, setAssignTarget] = useState<Space | null>(null)

  const rates: DefaultRates = useMemo(
    () => ({
      floorPerSqm: DEFAULT_RATES.floorPerSqm,
      wallPerSqm: DEFAULT_RATES.wallPerSqm,
      currency: DEFAULT_RATES.currency,
    }),
    [],
  )

  const materialsById = useMemo(() => {
    const map = new Map<ID, Material>()
    if (!materials) return map
    for (const material of materials) map.set(material.id, material)
    return map
  }, [materials])

  const boq = useMemo(() => {
    if (!spaces) return null
    return calcProjectBoq(
      spaces.map((space) => {
        const measurements = calcMeasurements(space)
        return {
          spaceId: space.id,
          areas: {
            floorArea: measurements.floorArea,
            wallArea: measurements.wallArea,
            ceilingArea: measurements.ceilingArea,
          },
          assignments: {
            floorMaterial: space.floorMaterialId
              ? (materialsById.get(space.floorMaterialId) ?? null)
              : null,
            wallMaterial: space.wallMaterialId
              ? (materialsById.get(space.wallMaterialId) ?? null)
              : null,
            ceilingMaterial: space.ceilingMaterialId
              ? (materialsById.get(space.ceilingMaterialId) ?? null)
              : null,
          },
        }
      }),
      rates,
    )
  }, [spaces, materialsById, rates])

  const costsBySpaceId = useMemo(() => {
    if (!boq) return undefined
    const map = new Map<ID, SpaceCostEntry>()
    for (const [spaceId, breakdown] of boq.spaceBreakdowns) {
      map.set(spaceId, {
        totalAmount: breakdown.totalAmount,
        currency: breakdown.currency,
      })
    }
    return map
  }, [boq])

  // Project totals fed to the hero. Sum lives here so the hero stays a pure
  // presenter and rates / BOQ stay in the materials feature.
  const projectFloorArea = useMemo(() => {
    if (!spaces) return 0
    return spaces.reduce((sum, space) => sum + calcMeasurements(space).floorArea, 0)
  }, [spaces])
  const projectWallArea = useMemo(() => {
    if (!spaces) return 0
    return spaces.reduce((sum, space) => sum + calcMeasurements(space).wallArea, 0)
  }, [spaces])

  // Map Material → SurfaceVisual for each space. Walks once at render to
  // avoid recomputing inside every SpaceCard.
  const surfaceVisualsBySpaceId = useMemo(() => {
    if (!spaces) return undefined
    const map = new Map<ID, SpaceSurfaceVisuals>()
    for (const space of spaces) {
      const floor = space.floorMaterialId ? materialsById.get(space.floorMaterialId) : null
      const wall = space.wallMaterialId ? materialsById.get(space.wallMaterialId) : null
      const ceiling = space.ceilingMaterialId
        ? materialsById.get(space.ceilingMaterialId)
        : null
      map.set(space.id, {
        floor: toSurfaceVisual(floor ?? null),
        wall: toSurfaceVisual(wall ?? null),
        ceiling: toSurfaceVisual(ceiling ?? null),
      })
    }
    return map
  }, [spaces, materialsById])

  if (!projectId) {
    return <Navigate to={paths.projects} replace />
  }

  if (isLoading) {
    return (
      <Center py={96}>
        <Loader />
      </Center>
    )
  }

  if (isError || !project) {
    return (
      <Stack mt="xl">
        <EmptyState
          icon={Warning}
          title={t('projects:error')}
          description={t('projects:empty.description')}
        />
      </Stack>
    )
  }

  const handleSave = async (
    values: Parameters<typeof updateProjectMutation.mutate>[0]['input'],
  ) => {
    await updateProjectMutation.mutateAsync({ projectId, input: values })
    editModal.close()
  }

  const handleDelete = () => {
    modals.openConfirmModal({
      title: t('projects:delete.title'),
      children: (
        <Text fz="sm" c="dimmed">
          {t('projects:delete.body', { name: project.name })}
        </Text>
      ),
      labels: {
        confirm: t('projects:delete.confirm'),
        cancel: t('projects:actions.cancel'),
      },
      confirmProps: { color: 'danger' },
      centered: true,
      onConfirm: () => {
        deleteProjectMutation.mutate(projectId, {
          onSuccess: () => {
            if (currentUser?.organizationId) {
              void deleteSpacesForProject(currentUser.organizationId, projectId)
            }
            void navigate(paths.projects)
          },
          onError: () =>
            notifications.show({ color: 'red', message: t('projects:error') }),
        })
      },
    })
  }

  const openAssign = (space: Space) => {
    setAssignTarget(space)
    assignModal.open()
  }

  const closeAssign = () => {
    assignModal.close()
    setAssignTarget(null)
  }

  const handleAssignSubmit = async (assignments: MaterialAssignmentInput) => {
    if (!assignTarget) return
    await assignMutation.mutateAsync({
      spaceId: assignTarget.id,
      input: assignments,
    })
    closeAssign()
  }

  const assignTargetMeasurements = assignTarget ? calcMeasurements(assignTarget) : null

  if (deleteProjectMutation.isSuccess) {
    return (
      <Stack mt="xl">
        <EmptyState icon={FolderOpen} title={t('projects:empty.title')} />
      </Stack>
    )
  }

  const hasSpaces = Boolean(spaces && spaces.length > 0)
  const quotationHref = `/projects/${projectId}/quotation`
  const takeoffHref = `/projects/${projectId}/takeoff`

  const progress = projectProgress({
    hasProject: true,
    spaceCount: spaces?.length ?? 0,
    fullyAssigned: boq?.fullyAssigned ?? false,
  })

  const handleStepClick = (step: ProjectStep) => {
    if (step === 'quotation' && boq?.fullyAssigned) {
      void navigate(quotationHref)
      return
    }
    // For in-page steps, scroll into view if a matching section exists.
    if (typeof window === 'undefined') return
    const id =
      step === 'spaces'
        ? 'spaces-section-anchor'
        : step === 'materials'
          ? 'spaces-section-anchor' // materials are assigned per-space
          : null
    if (!id) return
    const target = window.document.getElementById(id)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <Stack gap={36}>
      <ProjectWorkspaceHeader
        project={project}
        onEdit={editModal.open}
        onDelete={handleDelete}
        takeoffHref={takeoffHref}
      />

      <ProjectFlowStepper progress={progress} onStepClick={handleStepClick} />

      {boq && hasSpaces ? (
        <Stack gap="lg">
          <ProjectCostHero
            boq={boq}
            floorArea={projectFloorArea}
            wallArea={projectWallArea}
            spaceCount={spaces?.length ?? 0}
          />
          <CategoryCompositionBar
            totals={boq.categoryTotals}
            grandTotal={boq.grandTotal}
          />
          {boq.fullyAssigned ? (
            <EstimateCompleteCard boq={boq} quotationHref={quotationHref} />
          ) : null}
        </Stack>
      ) : null}

      <div id="spaces-section-anchor" />
      <SpacesSection
        projectId={projectId}
        step="01"
        {...(costsBySpaceId ? { costsBySpaceId } : {})}
        {...(surfaceVisualsBySpaceId
          ? { getSurfaceVisuals: (space: Space) =>
              surfaceVisualsBySpaceId.get(space.id) ?? {
                floor: null,
                wall: null,
                ceiling: null,
              } }
          : {})}
        onAssignMaterials={openAssign}
        renderBreakdown={(space) => {
          const breakdown = boq?.spaceBreakdowns.get(space.id)
          return breakdown ? (
            <SpaceCostBreakdownView
              breakdown={breakdown}
              spaceLength={space.length}
              spaceWidth={space.width}
              spaceHeight={space.height}
            />
          ) : null
        }}
      />

      {boq && hasSpaces ? (
        <BoqSummary boq={boq} materialsById={materialsById} step="02" />
      ) : null}

      <ProjectFormModal
        opened={editOpened}
        onClose={editModal.close}
        project={project}
        onSubmit={handleSave}
        isSubmitting={updateProjectMutation.isPending}
        errorMessage={updateProjectMutation.error?.message ?? undefined}
      />

      {assignTarget && assignTargetMeasurements ? (
        <AssignMaterialsModal
          opened={assignOpened}
          onClose={closeAssign}
          spaceName={assignTarget.name}
          spaceLength={assignTarget.length}
          spaceWidth={assignTarget.width}
          spaceHeight={assignTarget.height}
          floorArea={assignTargetMeasurements.floorArea}
          wallArea={assignTargetMeasurements.wallArea}
          ceilingArea={assignTargetMeasurements.ceilingArea}
          current={{
            floorMaterialId: assignTarget.floorMaterialId,
            wallMaterialId: assignTarget.wallMaterialId,
            ceilingMaterialId: assignTarget.ceilingMaterialId,
          }}
          materials={materials ?? []}
          rates={rates}
          onSubmit={handleAssignSubmit}
          isSubmitting={assignMutation.isPending}
          errorMessage={assignMutation.error?.message ?? undefined}
        />
      ) : null}
    </Stack>
  )
}
