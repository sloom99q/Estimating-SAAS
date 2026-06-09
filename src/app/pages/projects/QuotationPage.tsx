import { Anchor, Button, Center, Group, Loader, Stack, Text } from '@mantine/core'
import { ArrowLeft, Printer, Warning } from '@phosphor-icons/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import {
  calcProjectBoq,
  useMaterials,
  type DefaultRates,
  type Material,
} from '@/features/materials'
import { useProject } from '@/features/projects'
import { QuotationDocumentView, buildQuotation } from '@/features/quotations'
import {
  calcMeasurements,
  DEFAULT_RATES,
  useSpaces,
} from '@/features/spaces'
import { DirectionalIcon, EmptyState, PageHeader } from '@/shared/ui'
import type { ID } from '@/shared/types'

/**
 * Composition root for the printable quotation. Lives in `app/pages/` (not
 * inside any feature) because it stitches `projects`, `spaces`, `materials`
 * and `quotations` together — the architecture rules forbid cross-feature
 * imports inside the feature tree, so the join happens here.
 *
 * Data path:  Project + Spaces (+ Materials) → calcProjectBoq() → buildQuotation()
 *             → QuotationDocumentView (printable)
 */
export function QuotationPage() {
  const { t } = useTranslation(['quotations', 'projects'])
  const { projectId } = useParams<{ projectId: string }>()

  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: spaces, isLoading: spacesLoading } = useSpaces(projectId)
  const { data: materials } = useMaterials()

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
    if (materials) {
      for (const material of materials) map.set(material.id, material)
    }
    return map
  }, [materials])

  const document = useMemo(() => {
    if (!project || !spaces) return null
    const boq = calcProjectBoq(
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

    return buildQuotation({
      project: {
        id: project.id,
        name: project.name,
        clientName: project.clientName,
        location: project.location,
        type: project.type,
        status: project.status,
      },
      // Deterministic timestamp seeded from the project so re-rendering the
      // page in the same session produces the same reference. A real backend
      // will hand us a real `issuedAt` once the document is persisted.
      issuedAt: project.updatedAt,
      spaces: spaces.map((space) => {
        const breakdown = boq.spaceBreakdowns.get(space.id)
        const measurements = calcMeasurements(space)
        return {
          id: space.id,
          name: space.name,
          length: space.length,
          width: space.width,
          height: space.height,
          floorArea: measurements.floorArea,
          wallArea: measurements.wallArea,
          ceilingArea: measurements.ceilingArea,
          amount: breakdown?.totalAmount ?? '0.00',
          fullyAssigned: breakdown?.fullyAssigned ?? false,
        }
      }),
      materials: boq.lines.map((line) => ({
        materialId: line.materialId,
        materialName: line.materialName,
        category: line.category,
        unit: line.unit,
        totalArea: line.totalArea,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.totalAmount,
      })),
      categoryTotals: boq.categoryTotals.map((entry) => ({
        category: entry.category,
        amount: entry.amount,
      })),
      grandTotal: boq.grandTotal,
      currency: boq.currency,
      unassignedSurfaceArea: boq.unassignedSurfaceArea,
      fullyAssigned: boq.fullyAssigned,
    })
  }, [project, spaces, materialsById, rates])

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print()
  }

  if (projectLoading || spacesLoading) {
    return (
      <Center py={96}>
        <Loader />
      </Center>
    )
  }

  if (!project || !document) {
    return (
      <Stack mt="xl">
        <EmptyState
          icon={Warning}
          title={t('projects:error')}
          description={t('quotations:notReady.description')}
        />
      </Stack>
    )
  }

  const backHref = `/projects/${projectId}`

  return (
    <Stack gap="xl">
      <PageHeader
        title={t('quotations:page.title')}
        description={t('quotations:page.description', { name: project.name })}
        actions={
          <Group gap="sm" wrap="nowrap" className="quotation-actions">
            <Button
              variant="default"
              leftSection={<Printer size={16} weight="bold" />}
              onClick={handlePrint}
            >
              {t('quotations:page.print')}
            </Button>
          </Group>
        }
      />

      <Anchor
        component={Link}
        to={backHref}
        fz="sm"
        c="dimmed"
        underline="hover"
        w="fit-content"
        className="quotation-actions"
      >
        <Group gap={6} wrap="nowrap">
          <DirectionalIcon icon={ArrowLeft} size={14} />
          <Text fz="sm">{t('quotations:page.back')}</Text>
        </Group>
      </Anchor>

      <QuotationDocumentView document={document} />
    </Stack>
  )
}
