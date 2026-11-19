# Inventory and staff changes — implementation report

Branch: `finalized-roles`. Date: 2026-11-18.

## Scope and behavior

### Backend permissions (`backend/auth.py`)

- Added `view_inventory` to clerks, buyers, store managers, and app admins.
- Removed `manage_stock` from buyers, as confirmed for this request.
- Clerks retain `manage_stock`; managers/app admins retain both stock and inventory-management permissions.

### Inventory API (`backend/routers/inventory.py`)

- Staff inventory reads require `view_inventory` and assigned-store access.
- Single/batch writes check every store before any write. Non-managers can only change quantities of existing active inventory.
- Explicit price/status fields are rejected for clerks, including explicit null values; neither API silently discards a forbidden field.
- Existing active rows are locked while validating clerk updates, so a concurrent inventory change cannot bypass the active-only check.
- Push, approval, and removal require `manage_inventory` plus store access. All push destinations are checked before inserting anything.
- App admins continue to bypass assignment restrictions through `manage_all_stores`.
- CSV preview/import/export and low-stock settings already checked store access; their implementation was retained. CSV imports remain quantity-only.
- Public shopper stock endpoints were left public.

### Staff API (`backend/routers/admin.py`)

- Replaced the broken whole-account PUT with `PUT /api/admin/staff/{user_id}/stores/{store_id}`, accepting `{role}` and returning the assignment.
- Adding/saving one store uses an insert with conflict handling; other assignments are preserved.
- A global role change requires authority over every existing assignment. An unchanged role can be assigned to another managed store without touching outside assignments.
- Removal affects only the selected store. Removing the last assignment returns the account to `user`; otherwise its global role stays unchanged.
- DELETE returns the resulting account profile, and the frontend response type now matches.
- Managers can assign clerks/buyers; app admins can also assign store managers. Self changes and management of app-admin accounts remain blocked.
- Candidate search includes eligible existing staff at other stores. Staff listing returns the `users` shape consumed by the current frontend.
- Kept one row lock per target user to serialize role/assignment changes. Removed the obsolete complete-assignment replacement helpers/queries.
- Router length decreased from 418 to 164 lines.

### Existing frontend compatibility

- Role types now recognize clerks and the new read permission.
- Buyers retain Manage, inventory viewing, order routes, and notifications; their CSV controls and stock editing are unavailable.
- Clerks can save quantity-only changes. Price editing, status editing, approval, and pending-entry modification are unavailable to them.
- Clerks do not see reorder links or participate in staff-order notification polling.
- Staff role choices/labels include clerks, and the editor explains that roles are global while store assignments are separate.
- No guest flow was implemented. Remaining frontend consistency/direct-route checks are recorded in the sprint plan.

## Verification

- First expanded run after correcting a test-file encoding issue: 177 tests passed across auth sync, inventory, staff, stock CSV, low-stock settings, and reorders.
- Added four further inventory regressions (quantity batches, protected later batch field, removed assignment, demotion). Reran inventory suite: 86 tests passed. This covers 181 distinct passing cases across the six suites.
- Used an isolated local PostgreSQL 17 server and throwaway databases. An external test-runner adapter replaced only testcontainers provisioning; application SQL, auth dependencies, and FastAPI requests ran normally. No development database was used.
- Used a temporary Python environment because the project virtual-environment launcher was inaccessible. FastAPI, Pydantic, Starlette, and Psycopg versions matched the pinned project versions.
- TypeScript `tsc --noEmit` passed.
- The project lint command could not start because ESLint is not installed in project dependencies. Ran the existing Expo ESLint config using temporary tooling instead: 10 errors and 2 warnings, identical in the before/after sources of every touched frontend file. No new lint findings. Existing findings concern unescaped JSX apostrophes, unused variables, synchronous effect updates, and Animated refs.
- `git diff --check` and Python compilation passed.
- Physical-device interaction was not exercised.

Normal backend test command from `backend/`, with Docker running and test dependencies installed:

```bash
python -m pytest tests/test_auth_user_sync.py tests/test_inventory_api.py tests/test_staff_api.py tests/test_stock_csv.py tests/test_low_stock_settings.py tests/test_reorders.py -q
```

## Change metrics

Measured against a source snapshot taken at the beginning of this request, using Git line-diff counts with line endings ignored. These counts include comments/blank lines and count a replaced line once as a deletion and once as an insertion. They exclude the clerk migration/schema edits from the previous request and exclude both Markdown documents.

| Category | Files | Added lines | Removed lines | Net |
|---|---:|---:|---:|---:|
| Backend | 3 | 113 | 343 | -230 |
| Frontend | 10 | 27 | 17 | +10 |
| Tests | 4 | 212 | 73 | +139 |
| Total | 17 | 352 | 433 | -81 |

Application code alone: 13 files, 140 lines added and 360 removed (net 220 fewer lines).

| File | Added | Removed |
|---|---:|---:|
| `backend/auth.py` | 4 | 1 |
| `backend/routers/admin.py` | 83 | 337 |
| `backend/routers/inventory.py` | 26 | 5 |
| `backend/tests/test_auth_user_sync.py` | 4 | 4 |
| `backend/tests/test_inventory_api.py` | 118 | 56 |
| `backend/tests/test_staff_api.py` | 62 | 3 |
| `backend/tests/test_stock_csv.py` | 28 | 10 |
| `mobile/src/components/app-tabs.tsx` | 1 | 0 |
| `mobile/src/components/notification-banner.tsx` | 1 | 1 |
| `mobile/src/app/(tabs)/manage/index.tsx` | 3 | 2 |
| `mobile/src/app/admin/inventory/index.tsx` | 1 | 1 |
| `mobile/src/app/admin/inventory/[productId].tsx` | 10 | 4 |
| `mobile/src/app/admin/inventory/_layout.tsx` | 1 | 1 |
| `mobile/src/app/admin/reorders/_layout.tsx` | 2 | 2 |
| `mobile/src/app/admin/staff/index.tsx` | 4 | 3 |
| `mobile/src/api/general.ts` | 3 | 2 |
| `mobile/src/api/staff.ts` | 1 | 1 |

## Database rollout

The earlier `020-clerk-role.sql` migration remains unmodified and has not been applied to a running development database. Apply it once from `backend/`:

```bash
docker compose exec db psql -U mccs -d mccs -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/migrations/020-clerk-role.sql
```

Existing sessions may need profile refresh or sign-out/sign-in to update the UI. API permissions and assignments are loaded from the database on each authenticated request.

## Next work

See [remaining-nc-sprint-plan.md](remaining-nc-sprint-plan.md) for task-by-task scope and proposed guest defaults awaiting review. No future implementation is authorized by that document alone.
