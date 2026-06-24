-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "defaultLayerMap" JSONB;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "layerMap" JSONB;
