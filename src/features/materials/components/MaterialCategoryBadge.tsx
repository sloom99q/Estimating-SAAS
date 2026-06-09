import { Badge } from '@mantine/core'
import { useTranslation } from 'react-i18next'
import type { MaterialCategory } from '../domain/material.types'

const CATEGORY_COLOR: Record<MaterialCategory, string> = {
  tiles: 'info',
  marble: 'gray',
  paint: 'warn',
  gypsum: 'ink',
  glue: 'success',
  grout: 'danger',
  cladding: 'info',
  other: 'gray',
}

export function MaterialCategoryBadge({ category }: { category: MaterialCategory }) {
  const { t } = useTranslation(['materials'])
  return <Badge color={CATEGORY_COLOR[category]}>{t(`materials:categories.${category}`)}</Badge>
}
