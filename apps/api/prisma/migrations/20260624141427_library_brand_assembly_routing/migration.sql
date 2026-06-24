-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "defaultForFinishCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "takeoffCategory" "TakeoffCategory";

-- AlterTable
ALTER TABLE "boqs" ADD COLUMN     "libraryFingerprint" JSONB;

-- AlterTable
ALTER TABLE "materials" ADD COLUMN     "brandId" TEXT;

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "website" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_review_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "boqId" TEXT NOT NULL,
    "noteKey" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "boqLineId" TEXT,
    "resolvedAt" TIMESTAMPTZ(6),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boq_review_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brands_organizationId_category_active_idx" ON "brands"("organizationId", "category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "brands_organizationId_name_category_key" ON "brands"("organizationId", "name", "category");

-- CreateIndex
CREATE INDEX "boq_review_notes_projectId_resolvedAt_idx" ON "boq_review_notes"("projectId", "resolvedAt");

-- CreateIndex
CREATE INDEX "boq_review_notes_organizationId_projectId_idx" ON "boq_review_notes"("organizationId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "boq_review_notes_projectId_boqId_noteKey_key" ON "boq_review_notes"("projectId", "boqId", "noteKey");

-- CreateIndex
CREATE INDEX "assemblies_organizationId_takeoffCategory_sortOrder_idx" ON "assemblies"("organizationId", "takeoffCategory", "sortOrder");

-- CreateIndex
CREATE INDEX "assemblies_organizationId_brandId_idx" ON "assemblies"("organizationId", "brandId");

-- CreateIndex
CREATE INDEX "materials_organizationId_brandId_idx" ON "materials"("organizationId", "brandId");

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_review_notes" ADD CONSTRAINT "boq_review_notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_review_notes" ADD CONSTRAINT "boq_review_notes_boqId_fkey" FOREIGN KEY ("boqId") REFERENCES "boqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
