/**
 * Sprint-1 DoD helper: seed a SECOND org + admin user + one private project +
 * one private supplier. Then return that user's login credentials so the
 * isolation test can sign in as them.
 *
 *   bun apps/api/scripts/seed-second-org.ts
 */
import { prisma } from '../src/db'
import { hashPassword } from '../src/utils/auth'

async function main() {
  const orgSlug = 'isolation-test-org'
  const adminEmail = 'iso@estimator.app'
  const adminPassword = 'estimator'

  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    create: { name: 'Isolation Test Co.', slug: orgSlug, defaultCurrency: 'AED' },
    update: {},
  })
  const passwordHash = await hashPassword(adminPassword)
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      fullName: 'Iso Admin',
      passwordHash,
      isSuperAdmin: false,
    },
    update: { passwordHash },
  })
  await prisma.membership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: admin.id } },
    create: {
      organizationId: org.id,
      userId: admin.id,
      role: 'owner',
      status: 'active',
      joinedAt: new Date(),
    },
    update: { role: 'owner', status: 'active' },
  })
  const existingProject = await prisma.project.findFirst({
    where: { organizationId: org.id, name: 'Iso-Only Project' },
  })
  if (!existingProject) {
    await prisma.project.create({
      data: {
        organizationId: org.id,
        name: 'Iso-Only Project',
        clientName: 'Iso Client',
        location: 'Nowhere',
        type: 'residential',
        status: 'lead',
      },
    })
  }
  const existingSupplier = await prisma.supplier.findFirst({
    where: { organizationId: org.id, name: 'Iso-Only Supplier' },
  })
  if (!existingSupplier) {
    await prisma.supplier.create({
      data: {
        organizationId: org.id,
        name: 'Iso-Only Supplier',
        country: 'Nowhere',
        preferred: true,
      },
    })
  }

  console.log(`org=${org.id} email=${adminEmail} password=${adminPassword}`)
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(0)))
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
