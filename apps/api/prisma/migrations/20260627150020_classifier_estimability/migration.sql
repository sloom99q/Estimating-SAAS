-- CreateEnum
CREATE TYPE "Estimability" AS ENUM ('MEASURED', 'DERIVED', 'PROVISIONAL', 'PLACEHOLDER', 'MANUAL');

-- AlterTable
ALTER TABLE "takeoff_items" ADD COLUMN     "estimability" "Estimability" DEFAULT 'MEASURED';
