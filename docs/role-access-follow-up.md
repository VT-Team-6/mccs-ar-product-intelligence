# Review access, order reassignment, and frontend guards

Implemented on `finalized-roles`, 2026-11-18. Guest access is unchanged.

## 1. Review-source management

- `backend/routers/reviews.py` now requires `aggregate_reviews` for candidate
  lookup, saved-source reads/updates, and review imports. Only app admins have
  that permission in the current role map.
- Public product review reads remain public. Product image discovery remains
  available to managers because it does not change review sources.
- The product detail source/import/aggregation controls and post-create source
  selector are app-admin-only. A manager creating a product goes directly to
  its detail screen instead of opening a selector that the API would reject.

## 2. Current buyer access and reassignment

- Request lists, item lists, detail reads, and responses require the current
  buyer role and store assignment. An old `buyer_user_id` alone grants no access.
  Managers can still read requests for their stores; app admins retain full access.
- Former buyers' order notifications are also filtered from message lists and
  unread counts. Store-manager notifications respect current store assignments;
  app admins do not receive low-stock notifications.
- Requests are retained after demotion/removal. `needs_reassignment` is computed
  when an ineligible buyer still has pending, non-restocked work. Requests that
  only contain ordered/unavailable/received items are not automatically reassigned.
- Managers see a notice on the Reorders screen and a flag in the request list.
  Open the affected request and select **Reassign buyer** to choose a current
  buyer assigned to that store. The backend endpoint is:

  `PUT /api/order-requests/{request_id}/buyer` with `{"buyer_user_id": 123}`.

- Reassignment changes the request's current buyer, not the request/item IDs,
  quantities, statuses, unavailable reasons, or inventory's default buyer settings.
  It saves the previous/new buyer and manager in an audit table and notifies the
  replacement. Repeating an unchanged assignment does not duplicate audit rows
  or notifications while the request still has pending work.
- Each response now records `updated_by`. A replacement can handle pending items
  and their own responses, but cannot overwrite a previous buyer's completed work.
  The old buyer loses access even if they remain a buyer at the store.
- Responses and reassignment lock the same request row so a concurrent response
  cannot slip through after ownership changes. Writes commit or roll back together.
- The UI displays response attribution and reassignment history. Staff removal
  itself is not blocked, and no replacement is selected automatically.

## 3. Frontend route access and profile refresh

- Section layouts and screens check permissions. Low-stock settings and order
  sending require a manager with access to the selected store.
- Management navigation refreshes the backend profile while keeping the stack
  mounted. The Manage menu refreshes on focus as well.
- Returning to the foreground refreshes the profile silently, preserving forms
  when access remains valid. Existing session/request version checks prevent an
  old account's response from replacing the current profile.
- Product edit screens additionally check product ownership. Order detail screens
  check the loaded request's store and current buyer/manager access.
- These checks improve the UI; backend authorization remains authoritative.
  External changes made while the app stays active are reflected on the next
  navigation/profile refresh, not through continuous polling.

## Migration and rollout

Apply `021-order-request-reassignment.sql` once to an existing database, after
the earlier migrations. From `backend/`:

```bash
docker compose exec db psql -U mccs -d mccs -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/migrations/021-order-request-reassignment.sql
```

The migration adds item attribution and the reassignment audit table. Existing
responses are attributed to the buyer currently recorded on their request; no
older per-response audit data existed. New responses record the actual actor.
It preserves users, assignments, requests, and item progress. Fresh database
initialization includes it automatically. The development database was not modified.

## Verification

- 215 backend tests passed across reorders, review permissions, inventory, CSV,
  low-stock settings, staff assignment, and authentication synchronization.
- Tests cover buyer demotion/removal, lists/details/responses/notifications,
  manager and app-admin reassignment, invalid or foreign-store buyers, repeated
  assignments, preserved item progress/actors, and migration of existing responses.
- The frontend store-access tests cover removed assignments and invalid store
  IDs. TypeScript, Python compilation, and `git diff --check` passed.
- Tests used isolated PostgreSQL 17 databases with the local provisioning adapter
  described in the earlier implementation report; AWS calls were replaced by fakes.
- The existing Expo ESLint config was run through temporary tooling. There are no
  new findings in touched frontend files; one pre-existing AuthContext
  `react-hooks/set-state-in-effect` error remains. Removed three existing unused
  variable/import warnings and the order-detail effect error.
- Physical-device navigation/background/foreground behavior still needs a manual
  check. The store-access tests do not simulate a native navigation stack.

Run the frontend policy tests from `mobile/`:

```bash
node --experimental-strip-types --test tests/store-access.test.cjs
```

## Change size for this request

Measured against the source snapshot at the start of this request, ignoring line
endings and excluding documentation and earlier uncommitted work:

| Category | Files | Added lines | Removed lines |
|---|---:|---:|---:|
| Application code and migration | 15 | 304 | 51 |
| Tests | 3 | 286 | 0 |
| Total | 18 | 590 | 51 |
