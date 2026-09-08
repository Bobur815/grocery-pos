-- Redact the leaked PostgreSQL password from terminal_logs.
--
-- Background: electron.vite.config.ts called loadEnv(mode || 'pos', ...), which never loaded
-- .env.pos, so APP_ENV_KEYS were baked from the root .env — the server's config. DATABASE_URL was
-- therefore compiled into the terminal bundle and logged verbatim at every startup by
-- regos-vcr-service.ts as:
--   [fiscal] resolved config at startup {"db":"postgresql://postgres:<password>@localhost:5432/grocery_pos", ...}
-- Those lines were uploaded by POST /logs/upload and stored in this table.
--
-- This REDACTS rather than deletes. The rest of the diagnostic (enabled/url/login/posId/whether
-- the VCR password row decrypted) is worth keeping; only the credential has to go, so the
-- super-admin Logs page keeps its history.
--
-- Run on the VPS:
--   psql "$DATABASE_URL" -f purge-leaked-db-password.sql
-- Staging is the same file against posgro_staging.
--
-- IMPORTANT — this does not un-leak anything. The password shipped inside installers on
-- https://pos.bobur-dev.uz/releases/ and sits in electron-log files on every terminal's disk.
-- Rotate the PostgreSQL password FIRST; this is tidying up afterwards, not the fix.
--
-- Patterns below use only POSIX bracket expressions and capturing groups — no \s inside a
-- bracket, no (?:...) — so they behave identically on every PostgreSQL version.

\set ON_ERROR_STOP on

BEGIN;

-- 1. What is about to change. Read this before committing.
SELECT
  store_id,
  terminal_id,
  count(*)       AS affected_rows,
  min(timestamp) AS first_seen,
  max(timestamp) AS last_seen
FROM terminal_logs
WHERE message ~ 'postgres(ql)?://[^/?#" ]*@'
GROUP BY store_id, terminal_id
ORDER BY affected_rows DESC;

-- 2. Drop the whole authority (username and password) from every connection string in the
--    message. Mirrors redactConnection() in regos-vcr-service.ts, which is deliberately greedy:
--    a password containing an unescaped "@" would otherwise survive in part. 'g' because one
--    line could carry more than one URL.
--    \1 is the scheme group; (ql)? is group 2 and is not referenced.
UPDATE terminal_logs
SET message = regexp_replace(message, '(postgres(ql)?://)[^/?#" ]*@', '\1***@', 'g')
WHERE message ~ 'postgres(ql)?://[^/?#" ]*@';

-- 3. Prove nothing survived. Both counts must be 0.
SELECT
  count(*) FILTER (WHERE message ~ 'postgres(ql)?://[^/?#" ]*:[^/?#" ]*@') AS rows_with_credentials,
  count(*) FILTER (WHERE message LIKE '%' || :'leaked_password' || '%') AS rows_with_literal_password
FROM terminal_logs;

-- 4. Sample the rewritten rows before committing.
SELECT terminal_id, timestamp, left(message, 160) AS message_head
FROM terminal_logs
WHERE message LIKE '%[fiscal] resolved config at startup%'
ORDER BY timestamp DESC
LIMIT 5;

-- Review the output above, then finish with COMMIT to keep the redaction,
-- or ROLLBACK to change nothing.
COMMIT;
