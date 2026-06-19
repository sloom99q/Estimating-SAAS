-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "TakeoffCategory" AS ENUM ('ROOM', 'DOOR', 'WINDOW', 'FLOOR_FINISH', 'WALL_FINISH', 'CEILING', 'SCREED', 'PAINT', 'PLASTER', 'BLOCKWORK', 'WATERPROOFING', 'METAL', 'GRC', 'JOINERY', 'SANITARY', 'EXTERNAL', 'STRUCTURE_PROV', 'MEP_PROV', 'OTHER');

-- CreateEnum
CREATE TYPE "TakeoffBasis" AS ENUM ('MEASURED', 'DERIVED', 'VISUAL', 'PARAMETRIC', 'PLACEHOLDER');

-- CreateEnum
CREATE TYPE "TakeoffStatus" AS ENUM ('AI', 'EDITED', 'APPROVED');

-- CreateEnum
CREATE TYPE "ValidationSeverity" AS ENUM ('ERROR', 'WARN', 'INFO');

-- AlterTable
ALTER TABLE "spaces" ADD COLUMN     "areaM2" DECIMAL(10,2),
ADD COLUMN     "code" TEXT,
ADD COLUMN     "confidence" INTEGER,
ADD COLUMN     "floor" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "pageCount" INTEGER,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNo" INTEGER NOT NULL,
    "drawingNo" TEXT,
    "title" TEXT,
    "discipline" TEXT,
    "sheetType" TEXT,
    "scaleNote" TEXT,
    "hasTextLayer" BOOLEAN NOT NULL DEFAULT false,
    "rawTextKey" TEXT,
    "imageKey" TEXT,
    "aiJson" JSONB,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takeoff_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" "TakeoffCategory" NOT NULL,
    "tag" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qtyAi" DECIMAL(14,4),
    "qtyFinal" DECIMAL(14,4),
    "basis" "TakeoffBasis" NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "sourceSheetId" TEXT,
    "sourceNote" TEXT,
    "status" "TakeoffStatus" NOT NULL DEFAULT 'AI',
    "meta" JSONB,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "takeoff_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validation_flags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "takeoffItemId" TEXT,
    "rule" TEXT NOT NULL,
    "severity" "ValidationSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "validation_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "aiValue" TEXT,
    "humanValue" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_organizationId_projectId_idx" ON "documents"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "documents_organizationId_status_idx" ON "documents"("organizationId", "status");

-- CreateIndex
CREATE INDEX "sheets_organizationId_documentId_idx" ON "sheets"("organizationId", "documentId");

-- CreateIndex
CREATE INDEX "sheets_organizationId_discipline_idx" ON "sheets"("organizationId", "discipline");

-- CreateIndex
CREATE UNIQUE INDEX "sheets_documentId_pageNo_key" ON "sheets"("documentId", "pageNo");

-- CreateIndex
CREATE INDEX "takeoff_items_organizationId_projectId_category_idx" ON "takeoff_items"("organizationId", "projectId", "category");

-- CreateIndex
CREATE INDEX "takeoff_items_organizationId_projectId_status_idx" ON "takeoff_items"("organizationId", "projectId", "status");

-- CreateIndex
CREATE INDEX "takeoff_items_organizationId_projectId_confidence_idx" ON "takeoff_items"("organizationId", "projectId", "confidence");

-- CreateIndex
CREATE INDEX "validation_flags_organizationId_projectId_resolved_idx" ON "validation_flags"("organizationId", "projectId", "resolved");

-- CreateIndex
CREATE INDEX "validation_flags_organizationId_projectId_severity_idx" ON "validation_flags"("organizationId", "projectId", "severity");

-- CreateIndex
CREATE INDEX "corrections_organizationId_entity_entityId_idx" ON "corrections"("organizationId", "entity", "entityId");

-- CreateIndex
CREATE INDEX "corrections_organizationId_createdAt_idx" ON "corrections"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "spaces_organizationId_projectId_source_idx" ON "spaces"("organizationId", "projectId", "source");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheets" ADD CONSTRAINT "sheets_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_items" ADD CONSTRAINT "takeoff_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_items" ADD CONSTRAINT "takeoff_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_items" ADD CONSTRAINT "takeoff_items_sourceSheetId_fkey" FOREIGN KEY ("sourceSheetId") REFERENCES "sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_flags" ADD CONSTRAINT "validation_flags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_flags" ADD CONSTRAINT "validation_flags_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validation_flags" ADD CONSTRAINT "validation_flags_takeoffItemId_fkey" FOREIGN KEY ("takeoffItemId") REFERENCES "takeoff_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
