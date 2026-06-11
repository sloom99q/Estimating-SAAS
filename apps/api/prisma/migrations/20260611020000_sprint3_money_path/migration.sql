-- AlterTable
ALTER TABLE "material_supplier_prices" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "minimumOrderQuantity" SET DATA TYPE DECIMAL(14,4);

-- AlterTable
ALTER TABLE "materials" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "coverage" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "wastePct" SET DATA TYPE DECIMAL(5,2);

-- AlterTable
ALTER TABLE "price_snapshots" ALTER COLUMN "price" SET DATA TYPE DECIMAL(14,2);

-- CreateTable
CREATE TABLE "assemblies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "outputUnit" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "assemblies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_components" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assemblyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2),
    "coverage" DECIMAL(14,4),
    "coats" INTEGER NOT NULL DEFAULT 1,
    "wastagePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "fixedCost" DECIMAL(14,2),
    "materialId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assembly_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_library_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "source" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'SHJ',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "rate_library_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boqs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "subtotal" DECIMAL(14,2),
    "totalProvisional" DECIMAL(14,2),
    "generatedFromJobId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "boqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_sections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boqId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "boq_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boqId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "itemRef" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" DECIMAL(14,4),
    "rate" DECIMAL(14,2),
    "rateSource" TEXT,
    "amount" DECIMAL(14,2),
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "psAmount" DECIMAL(14,2),
    "confidence" INTEGER,
    "takeoffItemId" TEXT,
    "assemblyId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "boq_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boqId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vatPct" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "subtotal" DECIMAL(14,2),
    "total" DECIMAL(14,2),
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assemblies_organizationId_name_idx" ON "assemblies"("organizationId", "name");

-- CreateIndex
CREATE INDEX "assemblies_organizationId_appliesTo_idx" ON "assemblies"("organizationId", "appliesTo");

-- CreateIndex
CREATE INDEX "assembly_components_assemblyId_idx" ON "assembly_components"("assemblyId");

-- CreateIndex
CREATE INDEX "assembly_components_organizationId_idx" ON "assembly_components"("organizationId");

-- CreateIndex
CREATE INDEX "rate_library_items_organizationId_code_idx" ON "rate_library_items"("organizationId", "code");

-- CreateIndex
CREATE INDEX "rate_library_items_code_region_idx" ON "rate_library_items"("code", "region");

-- CreateIndex
CREATE UNIQUE INDEX "rate_library_items_organizationId_code_region_key" ON "rate_library_items"("organizationId", "code", "region");

-- CreateIndex
CREATE INDEX "boqs_organizationId_projectId_idx" ON "boqs"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "boqs_organizationId_projectId_version_key" ON "boqs"("organizationId", "projectId", "version");

-- CreateIndex
CREATE INDEX "boq_sections_organizationId_idx" ON "boq_sections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "boq_sections_boqId_code_key" ON "boq_sections"("boqId", "code");

-- CreateIndex
CREATE INDEX "boq_lines_organizationId_boqId_idx" ON "boq_lines"("organizationId", "boqId");

-- CreateIndex
CREATE INDEX "boq_lines_organizationId_takeoffItemId_idx" ON "boq_lines"("organizationId", "takeoffItemId");

-- CreateIndex
CREATE INDEX "quotations_organizationId_projectId_idx" ON "quotations"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_organizationId_ref_key" ON "quotations"("organizationId", "ref");

-- AddForeignKey
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_components" ADD CONSTRAINT "assembly_components_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_library_items" ADD CONSTRAINT "rate_library_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boqs" ADD CONSTRAINT "boqs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_sections" ADD CONSTRAINT "boq_sections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_sections" ADD CONSTRAINT "boq_sections_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "boqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "boqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "boq_sections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_lines" ADD CONSTRAINT "boq_lines_assemblyId_fkey" FOREIGN KEY ("assemblyId") REFERENCES "assemblies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "boqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

