-- Reorder notes, unavailable reasons and notifications are now saved encrypted
-- (backend/secure_text.py). Encrypted text is longer than the original, so the
-- notification title loses its 200-character limit; the app still cuts titles
-- to 200 characters before encrypting.
ALTER TABLE messages ALTER COLUMN subject TYPE TEXT;
