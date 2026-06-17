ALTER TABLE "llm_classifications" ADD COLUMN IF NOT EXISTS "actions_extracted_at" timestamptz;

-- Emails already processed (still have or had items) should not be re-extracted.
UPDATE "llm_classifications" lc
SET "actions_extracted_at" = NOW()
WHERE lc."actions_extracted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "action_items" ai WHERE ai."email_id" = lc."email_id"
  );
