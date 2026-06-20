-- AI-estimation engine roadmap #1
-- Adds the ESTIMATED basis + SKIRTING category. Both are additive
-- enum values; existing rows are unaffected.
ALTER TYPE "TakeoffBasis" ADD VALUE 'ESTIMATED';
ALTER TYPE "TakeoffCategory" ADD VALUE 'SKIRTING';
