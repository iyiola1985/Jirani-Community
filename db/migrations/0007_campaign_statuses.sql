-- New campaign states. They are not used in this file.
-- PostgreSQL cannot use an enum value added in the same transaction.

ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'under_review' BEFORE 'scheduled';
ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'approved' BEFORE 'scheduled';
