-- Repair the missing Address country-context migration without rewriting history.
-- Existing values must identify exactly one configured country. Never guess a
-- default country or invent Country records/currency configuration.
BEGIN;

LOCK TABLE "Address" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "Country" IN SHARE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Address" a
    WHERE (
      SELECT COUNT(*) FROM "Country" c
      WHERE LOWER(BTRIM(a."country")) = LOWER(c."code")
         OR LOWER(BTRIM(a."country")) = LOWER(c."name")
    ) <> 1
  ) THEN
    RAISE EXCEPTION 'Address country migration requires each legacy country value to match exactly one existing Country code or name. Configure countries and resolve unknown/ambiguous address values before retrying.';
  END IF;
END $$;

UPDATE "Address" a
SET "country" = c."code"
FROM "Country" c
WHERE LOWER(BTRIM(a."country")) = LOWER(c."code")
   OR LOWER(BTRIM(a."country")) = LOWER(c."name");

-- Rename preserves the existing required TEXT column and all address rows.
ALTER TABLE "Address" RENAME COLUMN "country" TO "countryCode";
ALTER TABLE "Address"
  ADD COLUMN "latitude" DECIMAL(10,7),
  ADD COLUMN "longitude" DECIMAL(10,7);

CREATE INDEX "Address_countryCode_idx" ON "Address"("countryCode");
ALTER TABLE "Address" ADD CONSTRAINT "Address_countryCode_fkey"
  FOREIGN KEY ("countryCode") REFERENCES "Country"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
