-- Remove the audit_logs feature. The model and all related code were dropped; the table is no
-- longer written to or read from on the server. CASCADE clears its FK/indexes.
DROP TABLE IF EXISTS "audit_logs" CASCADE;
