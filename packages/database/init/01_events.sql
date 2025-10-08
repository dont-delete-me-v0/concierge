-- Schema initialization for events table
-- This script runs automatically on first database initialization

CREATE TABLE IF NOT EXISTS public.events (
  id TEXT PRIMARY KEY,
  title TEXT,
  price TEXT,
  link TEXT,
  "eventId" TEXT,
  "dateTime" TEXT,
  venue TEXT,
  description TEXT
);

-- Optional index for quick search by eventId if present
CREATE INDEX IF NOT EXISTS idx_events_eventId ON public.events ("eventId");

