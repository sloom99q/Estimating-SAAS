import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useCurrentUser } from '@/shared/store/sessionStore'
import { paths } from '@/app/router/paths'
import { Section } from '@/shared/ui'
import {
  createOrganization,
  listOrganizations,
  type AdminOrgSummary,
  type CreateOrgPayload,
} from '../api/admin.api'

/**
 * Sprint-10 S10-1 — founder admin page. Lists every organisation with
 * cheap count summaries (ADR-018: counts only, no tenant business data)
 * and a small form to provision a new org + invite an owner.
 */
export function AdminOrgsPage() {
  const navigate = useNavigate()
  const user = useCurrentUser()
  const isFounder = user?.platformRole === 'founder'
  const qc = useQueryClient()

  const orgsQuery = useQuery({
    queryKey: ['admin', 'orgs'],
    queryFn: listOrganizations,
    enabled: isFounder,
  })

  const [modalOpened, modal] = useDisclosure(false)
  const [form, setForm] = useState<CreateOrgPayload>({
    name: '',
    slug: '',
    ownerEmail: '',
    ownerFullName: '',
    ownerInitialPassword: '',
  })

  const createMutation = useMutation({
    mutationFn: () => createOrganization(form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'orgs'] })
      modal.close()
      setForm({
        name: '',
        slug: '',
        ownerEmail: '',
        ownerFullName: '',
        ownerInitialPassword: '',
      })
    },
  })

  if (!isFounder) {
    return (
      <Stack gap="md">
        <Title order={2}>Founder admin</Title>
        <Alert color="red" variant="light" title="Access denied">
          This page is only visible to platform founders.
        </Alert>
        <Button variant="subtle" onClick={() => navigate(paths.dashboard)}>
          Back to dashboard
        </Button>
      </Stack>
    )
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Stack gap={4}>
          <Title order={2}>Organizations</Title>
          <Text c="dimmed" size="sm">
            Counts only — per ADR-018. To read a tenant's data, join their organization as a
            member; the trail is visible to them.
          </Text>
        </Stack>
        <Button onClick={modal.open}>Provision new org</Button>
      </Group>

      <Section title="Platform organizations">
        {orgsQuery.isLoading ? (
          <Text c="dimmed">Loading…</Text>
        ) : orgsQuery.isError ? (
          <Alert color="red" variant="light" title="Failed to load">
            {orgsQuery.error instanceof Error ? orgsQuery.error.message : 'Unknown error'}
          </Alert>
        ) : (
          <Card withBorder p={0}>
            <Table striped withTableBorder withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Slug</Table.Th>
                  <Table.Th>Members</Table.Th>
                  <Table.Th>Projects</Table.Th>
                  <Table.Th>Documents</Table.Th>
                  <Table.Th>Created</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(orgsQuery.data ?? []).map((o: AdminOrgSummary) => (
                  <Table.Tr key={o.id}>
                    <Table.Td>{o.name}</Table.Td>
                    <Table.Td>
                      <Badge variant="light">{o.slug}</Badge>
                    </Table.Td>
                    <Table.Td>{o.memberCount}</Table.Td>
                    <Table.Td>{o.projectCount}</Table.Td>
                    <Table.Td>{o.documentCount}</Table.Td>
                    <Table.Td>{new Date(o.createdAt).toLocaleDateString()}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        )}
      </Section>

      <Modal opened={modalOpened} onClose={modal.close} title="Provision new organization" centered>
        <Stack gap="sm">
          {createMutation.error ? (
            <Alert color="red" variant="light">
              {createMutation.error instanceof Error
                ? createMutation.error.message
                : 'Failed to create'}
            </Alert>
          ) : null}
          <TextInput
            label="Organization name"
            value={form.name}
            onChange={(e) => setForm((s) => ({ ...s, name: e.currentTarget.value }))}
            withAsterisk
          />
          <TextInput
            label="Slug"
            description="Lowercase letters, digits, dashes. Used in URLs."
            value={form.slug}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                slug: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
              }))
            }
            withAsterisk
          />
          <TextInput
            label="Owner full name"
            value={form.ownerFullName}
            onChange={(e) => setForm((s) => ({ ...s, ownerFullName: e.currentTarget.value }))}
            withAsterisk
          />
          <TextInput
            label="Owner email"
            type="email"
            value={form.ownerEmail}
            onChange={(e) => setForm((s) => ({ ...s, ownerEmail: e.currentTarget.value }))}
            withAsterisk
          />
          <PasswordInput
            label="Owner initial password"
            description="Share this securely; the owner will rotate it on first login."
            value={form.ownerInitialPassword}
            onChange={(e) =>
              setForm((s) => ({ ...s, ownerInitialPassword: e.currentTarget.value }))
            }
            withAsterisk
          />
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" onClick={modal.close}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={
                !form.name ||
                !form.slug ||
                !form.ownerEmail ||
                !form.ownerFullName ||
                form.ownerInitialPassword.length < 8
              }
            >
              Create
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  )
}
