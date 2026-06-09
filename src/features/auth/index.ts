// Public surface of the auth feature. Routes import the page module directly
// (for a clean code-split boundary); this barrel exposes the rest.
export { LoginPage } from './pages/LoginPage'
export { useLogin } from './api/useLogin'
export type { LoginCredentials } from './domain/auth.types'
