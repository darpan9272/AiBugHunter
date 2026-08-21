-- Migration: Add token tracking to agent_activity

ALTER TABLE agent_activity ADD COLUMN IF NOT EXISTS prompt_tokens INT DEFAULT 0;
ALTER TABLE agent_activity ADD COLUMN IF NOT EXISTS completion_tokens INT DEFAULT 0;
