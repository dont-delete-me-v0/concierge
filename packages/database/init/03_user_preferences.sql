-- User preferences table for personalization
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category_ids TEXT[], -- Array of category IDs user is interested in
  district_ids TEXT[], -- Array of district/venue IDs user prefers
  price_min NUMERIC(12,2), -- Minimum price preference
  price_max NUMERIC(12,2), -- Maximum price preference
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences (user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
CREATE TRIGGER update_user_preferences_updated_at BEFORE UPDATE
ON public.user_preferences FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

