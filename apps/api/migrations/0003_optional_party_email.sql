-- Producers and merchants do not always have an email address.
ALTER TABLE producers ALTER COLUMN email DROP NOT NULL;
ALTER TABLE merchants ALTER COLUMN email DROP NOT NULL;
