-- Add clerks as a global role; store assignments remain in user_stores.
BEGIN;

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('user', 'store_clerk', 'store_buyer', 'store_admin', 'system_admin'));

COMMIT;
