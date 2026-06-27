-- AlterTable
ALTER TABLE "boq_lines" ADD COLUMN     "verificationDetail" JSONB,
ADD COLUMN     "verificationStatus" TEXT DEFAULT 'PENDING';
