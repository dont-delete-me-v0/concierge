-- Core taxonomy: categories
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  parent_id TEXT REFERENCES public.categories(id)
);

-- Venues directory
CREATE TABLE IF NOT EXISTS public.venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  phone TEXT,
  website TEXT
);

-- Events table (normalized)
CREATE TABLE IF NOT EXISTS public.events (
  id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  category_id TEXT REFERENCES public.categories(id),
  venue_id TEXT REFERENCES public.venues(id),
  date_time TIMESTAMPTZ,
  price_from NUMERIC(12,2),
  source_url TEXT
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_events_category ON public.events (category_id);
CREATE INDEX IF NOT EXISTS idx_events_venue ON public.events (venue_id);
CREATE INDEX IF NOT EXISTS idx_events_date_time ON public.events (date_time);

