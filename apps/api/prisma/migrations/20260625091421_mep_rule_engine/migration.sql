-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TakeoffCategory" ADD VALUE 'MEP_HVAC';
ALTER TYPE "TakeoffCategory" ADD VALUE 'MEP_ELEC';
ALTER TYPE "TakeoffCategory" ADD VALUE 'MEP_PLUMB';
ALTER TYPE "TakeoffCategory" ADD VALUE 'MEP_ELV';

-- CreateTable
CREATE TABLE "mep_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "driverFilter" TEXT,
    "factor" DECIMAL(14,6) NOT NULL,
    "factorSource" TEXT,
    "factorConfidence" DECIMAL(4,3),
    "outputUnit" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "rateSource" TEXT,
    "rateConfidence" DECIMAL(4,3),
    "takeoffCategory" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "mep_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mep_rules_organizationId_discipline_active_idx" ON "mep_rules"("organizationId", "discipline", "active");

-- CreateIndex
CREATE INDEX "mep_rules_organizationId_takeoffCategory_idx" ON "mep_rules"("organizationId", "takeoffCategory");

-- CreateIndex
CREATE UNIQUE INDEX "mep_rules_organizationId_discipline_name_key" ON "mep_rules"("organizationId", "discipline", "name");

-- AddForeignKey
ALTER TABLE "mep_rules" ADD CONSTRAINT "mep_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
