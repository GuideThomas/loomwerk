-- v0.3: token and cost accounting per pipeline stage.
--
-- Tokens are the universal currency — every OpenAI-compatible endpoint
-- reports usage, no endpoint reports prices. cost_usd (already present on
-- runs) is filled from two honest sources: real cost a gateway returns
-- with the response, or a price computed from user-configured rates.
ALTER TABLE runs ADD COLUMN tokens_in  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN tokens_out INTEGER NOT NULL DEFAULT 0;
