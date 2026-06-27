-- CLASSIFIER-5 (2026-06-27) — split Estimability.PROVISIONAL into
-- PROVISIONAL_SUM (allowance pending) + LUMP_SUM (supplier quote in hand)
-- matching how UAE contractors actually quote.

ALTER TYPE "Estimability" ADD VALUE 'PROVISIONAL_SUM';
ALTER TYPE "Estimability" ADD VALUE 'LUMP_SUM';

-- Drop the old PROVISIONAL value. Safe — TakeoffItem.estimability
-- default was MEASURED on insert + the column had no production
-- writes of PROVISIONAL before the schema flip.
-- Postgres requires creating a new type + swapping for value removal.
ALTER TYPE "Estimability" RENAME TO "Estimability_old";
CREATE TYPE "Estimability" AS ENUM ('MEASURED','DERIVED','PROVISIONAL_SUM','LUMP_SUM','PLACEHOLDER','MANUAL');
ALTER TABLE "takeoff_items" ALTER COLUMN "estimability" DROP DEFAULT;
ALTER TABLE "takeoff_items"
  ALTER COLUMN "estimability" TYPE "Estimability"
  USING ("estimability"::text::"Estimability");
ALTER TABLE "takeoff_items" ALTER COLUMN "estimability" SET DEFAULT 'PROVISIONAL_SUM';
DROP TYPE "Estimability_old";
