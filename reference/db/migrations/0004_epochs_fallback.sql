-- Work epochs: a file reopened after a prompt, check or model change starts a
-- new ladder of attempts (epoch + 1). Earlier calls stay in the ledger and are
-- never resent; accepted documents of earlier epochs remain accepted.
ALTER TABLE files ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_calls ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;

-- A document written by the fallback model (kimi-k3, the checker's family)
-- is low confidence, for the same reason as `same_model`.
ALTER TABLE documents ADD COLUMN low_confidence INTEGER NOT NULL DEFAULT 0 CHECK (low_confidence IN (0,1));
ALTER TABLE documents ADD COLUMN low_confidence_reason TEXT;
