-- Demo accounts for staff management. These users have no Cognito accounts
-- and cannot sign in. Use a real signed-in admin to manage them.
-- Run after 002-stores.sql and all migrations (one global role per user).
-- Re-running skips existing users and duplicate assignments. It preserves
-- current user roles and does not remove any additional store assignments.

BEGIN;

INSERT INTO users (cognito_sub, email, role) VALUES
    ('demo-staff-alex',   'alex.staff@example.com',   'store_admin'),
    ('demo-staff-jamie',  'jamie.staff@example.com',  'store_admin'),
    ('demo-staff-taylor', 'taylor.staff@example.com', 'store_admin'),
    ('demo-staff-morgan', 'morgan.staff@example.com', 'store_buyer'),
    ('demo-staff-casey',  'casey.staff@example.com',  'store_buyer'),
    ('demo-staff-jordan', 'jordan.staff@example.com', 'store_buyer'),
    ('demo-staff-riley',  'riley.staff@example.com',  'store_buyer'),
    ('demo-staff-sam',    'sam.staff@example.com',    'store_buyer'),
    ('demo-staff-avery',  'avery.staff@example.com',  'user'),
    ('demo-staff-quinn',  'quinn.staff@example.com',  'user')
ON CONFLICT (cognito_sub) DO NOTHING;

-- Resolve database IDs by stable demo identities and seeded store names,
-- rather than assuming that user/store identity sequences start at 1.
INSERT INTO user_stores (user_id, store_id)
SELECT u.user_id, s.store_id
FROM (VALUES
    ('demo-staff-alex',   'MCCS Main Exchange'),
    ('demo-staff-jamie',  'MCCS Outlet Store'),
    ('demo-staff-taylor', 'MCCS Main Exchange'),
    ('demo-staff-taylor', 'MCCS Outlet Store'),
    ('demo-staff-morgan', 'MCCS Main Exchange'),
    ('demo-staff-casey',  'MCCS Outlet Store'),
    ('demo-staff-jordan', 'MCCS Main Exchange'),
    ('demo-staff-jordan', 'MCCS Outlet Store'),
    ('demo-staff-riley',  'MCCS Main Exchange'),
    ('demo-staff-sam',    'MCCS Outlet Store')
) AS assignment(cognito_sub, store_name)
JOIN users u ON u.cognito_sub = assignment.cognito_sub
JOIN stores s ON s.name = assignment.store_name
ON CONFLICT (user_id, store_id) DO NOTHING;

-- Avery and Quinn deliberately have no assignments: find them in Add staff.
COMMIT;
