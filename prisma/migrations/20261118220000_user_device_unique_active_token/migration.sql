-- Deactivate any legacy duplicate active tokens before creating unique partial index
UPDATE "UserDevice"
SET "isActive" = false
WHERE "id" NOT IN (
  SELECT "id" FROM (
    SELECT DISTINCT ON ("token") "id"
    FROM "UserDevice"
    WHERE "isActive" = true
    ORDER BY "token", "lastUsedAt" DESC, "updatedAt" DESC, "id" DESC
  ) active_tokens
) AND "isActive" = true;

-- Create partial unique index enforcing at most one active device row per token across all users
CREATE UNIQUE INDEX IF NOT EXISTS "UserDevice_token_active_key"
ON "UserDevice" ("token")
WHERE "isActive" = true;
