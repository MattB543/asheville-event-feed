-- Migration: Add semantic personalization columns to user_preferences
-- Date: 2024-12-28
-- Description: Adds columns for the "For You" personalization feature

-- Add positive_signals column (jsonb array of signal objects)
ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS positive_signals jsonb DEFAULT '[]'::jsonb;

-- Add negative_signals column (jsonb array of signal objects)
ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS negative_signals jsonb DEFAULT '[]'::jsonb;

-- Add positive_centroid column (1536-dimensional vector for user's positive interest profile)
ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS positive_centroid vector(1536);

-- Add negative_centroid column (1536-dimensional vector for user's negative interest profile)
ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS negative_centroid vector(1536);

-- Add centroid_updated_at column (timestamp for cache invalidation)
ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS centroid_updated_at timestamp;

-- Verify the columns were added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'user_preferences'
AND column_name IN ('positive_signals', 'negative_signals', 'positive_centroid', 'negative_centroid', 'centroid_updated_at');
