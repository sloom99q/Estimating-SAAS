import { createBrowserRouter, Navigate } from 'react-router'
import { AuthLayout } from '@/app/layouts/AuthLayout/AuthLayout'
import { DashboardLayout } from '@/app/layouts/DashboardLayout/DashboardLayout'
import { ProtectedRoute } from './guards/ProtectedRoute'
import { NotFoundPage } from './NotFoundPage'
import { paths } from './paths'
import { PublicOnlyRoute } from './guards/PublicOnlyRoute'

/**
 * Route tree (data router). Layouts are eager; PAGE modules are lazy via the
 * data-router-native `route.lazy`, so each page is its own chunk and the heavy
 * shells never re-download. Importing page modules directly (not through a
 * feature barrel) keeps the code-split boundary clean.
 */
export const router = createBrowserRouter([
  {
    element: <PublicOnlyRoute />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          {
            path: paths.login,
            lazy: async () => {
              const { LoginPage } = await import('@/features/auth/pages/LoginPage')
              return { Component: LoginPage }
            },
          },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Navigate to={paths.dashboard} replace /> },
          {
            path: paths.dashboard,
            lazy: async () => {
              const { DashboardPage } = await import('@/features/dashboard/pages/DashboardPage')
              return { Component: DashboardPage }
            },
          },
          {
            path: paths.projects,
            lazy: async () => {
              const { ProjectListPage } = await import(
                '@/features/projects/pages/ProjectListPage'
              )
              return { Component: ProjectListPage }
            },
          },
          {
            path: paths.projectDetail,
            lazy: async () => {
              const { ProjectWorkspacePage } = await import(
                '@/app/pages/projects/ProjectWorkspacePage'
              )
              return { Component: ProjectWorkspacePage }
            },
          },
          {
            path: paths.projectQuotation,
            lazy: async () => {
              const { QuotationPage } = await import(
                '@/app/pages/projects/QuotationPage'
              )
              return { Component: QuotationPage }
            },
          },
          {
            path: paths.materials,
            lazy: async () => {
              const { MaterialsListPage } = await import(
                '@/features/materials/pages/MaterialsListPage'
              )
              return { Component: MaterialsListPage }
            },
          },
          {
            path: paths.materialDetail,
            lazy: async () => {
              const { MaterialDetailPage } = await import(
                '@/app/pages/materials/MaterialDetailPage'
              )
              return { Component: MaterialDetailPage }
            },
          },
          {
            path: paths.suppliers,
            lazy: async () => {
              const { SuppliersListPage } = await import(
                '@/features/suppliers/pages/SuppliersListPage'
              )
              return { Component: SuppliersListPage }
            },
          },
          {
            path: paths.users,
            lazy: async () => {
              const { UsersPage } = await import('@/features/users/pages/UsersPage')
              return { Component: UsersPage }
            },
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
