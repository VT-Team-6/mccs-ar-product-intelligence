# Remaining NC sprint work — proposed plan

Prepared on 2026-11-18 for `finalized-roles`, using the earlier sprint backlog
(NC tasks 10–13 and 38–42) and the finalized role requirements. Future work
below is a proposal for review, not implemented guest functionality.

## Decisions already agreed

- One global role per account: `user`, `store_clerk`, `store_buyer`,
  `store_admin`, or `system_admin`. `user_stores` holds assignments, not roles.
- Buyers view inventory and answer order requests; clerks and managers update
  quantities and import end-of-day stock CSV files.
- App admins have all-store access. Other staff are limited to assigned stores.
- Managers can assign clerks/buyers, and app admins can also assign managers.
- Guests can discover products, read AI analysis, and get recommendations based
  on the current product/query. Profile-based recommendations are signed-in only.
  Guests cannot like products or save personal data. Compare requires an account.

## What this implementation handles

- Task 10 foundation: clerk role migration, schemas, and permission mapping.
- Task 11 inventory: store checks for staff reads, single/batch updates,
  approvals, pushes, removals, and existing CSV routes; clerks cannot change
  prices/status or create/approve inventory. Buyers are read-only.
- Staff endpoint repair: per-store assignment saves/removals preserve other
  assignments. Global role changes cannot affect stores outside the caller's scope.
- Task 12 compatibility: existing Manage/inventory/staff screens recognize clerks
  and read-only buyers. Order links/notifications remain available to buyers.
- Focused API regression tests for those changes, CSV, low stock, and reorders.

## 1. Backend authorization follow-up (implemented)

- Review-source management/imports now require the app-admin aggregation permission.
  Product image discovery remains available to managers; it does not manage review sources.
- Order lists, item lists, detail access, responses, and notifications check the
  buyer's current role and store access. Previous ownership alone does not grant access.
- Managers see requests needing reassignment and can choose a current store buyer.
  Statuses/reasons are preserved, responses are attributed, and reassignment history is saved.
- Reassignment and responses lock the same request row. A new buyer cannot overwrite
  another buyer's completed responses. App admins retain their explicit full-access override.
- Store-manager actions remain store-scoped. Low-stock messages remain manager-only.
- Regression tests cover revocation, reassignment, invalid buyers, and cross-store access.

Apply the new `021-order-request-reassignment.sql` migration before using these APIs.

## 2. Frontend access follow-up (implemented; device verification remains)

- Management layouts and screens protect direct links and store-specific forms.
  Low-stock settings and order sending are manager-only; product editing checks ownership.
- Management entry and navigation refresh the backend profile while preserving the stack.
  Returning to the foreground refreshes silently, preserving in-progress forms.
- Review-source controls and the post-create source selector are app-admin-only.
- Managers see reassignment notices and a buyer picker on requests with pending work.
  Existing completed responses display their actor and remain protected from replacement buyers.
- Automated checks cover store access and removed assignments.
- Still exercise these flows on a physical device, including background/foreground,
  direct links, permission changes, and a partly completed reassignment.

## 3. Finish role verification and demo preparation (task 13)

- Test guest/shopper rejection of management endpoints, each staff role at an
  assigned and unassigned store, and app admin at a store with no assignment.
- Verify mixed-store batches/pushes fail without partial writes.
- Verify a clerk cannot change prices/status through single edits, batches, or CSV.
- Verify staff saves preserve other stores, last-assignment removal returns the
  account to shopper, and global role changes require full assignment authority.
- Run typechecking/lint and exercise the phone UI with sample accounts.
- Apply migration `020-clerk-role.sql` to an existing development database once;
  fresh database initialization includes it automatically. No volume deletion required.

## 4. Allow entry without signing in (task 38)

Files: `mobile/src/auth/AuthenticatedApp.tsx`, `AuthContext.tsx`,
`mobile/src/app/_layout.tsx`, Account, and a dedicated sign-in route.

- Proposed default: open directly into guest browsing when there is no session.
  Keep Sign in/Create account available from Account and restricted actions.
- Represent a guest as `user = null`, `profile = null`; do not create guest
  database users or add a guest database role.
- Keep auth startup loading distinct from a guest session and a profile fetch
  failure. A signed-in profile error should expose retry/sign-out options.
- Move the existing authentication UI to an explicit route/modal instead of
  replacing the entire application when signed out.
- Return to the originating product/action after sign-in when practical, with
  Home as the safe fallback; do not automatically repeat a write action.

## 5. Make discovery APIs and store selection guest-capable (task 39)

Backend:

- Scan, search, product details, public stock, store lookup, and product images
  already have public/optional-auth paths. Verify rather than duplicate them.
- Make `GET /api/products/{product_id}/analysis` publicly readable. It returns
  saved analysis; keep AI generation/refresh and source management privileged.
- Make `POST /api/recommendations` use optional authentication. For guests,
  supply the same default saved ranks as a new shopper and no liked IDs;
  skip personal preference queries and user-linked impression writes. Return
  the ordinary product/query matches, with no profile-based `for_you` result.
- Hide the personalized recommendation section for guests; keep ordinary
  recommendations and AI analysis available without sign-in.
- Continue accepting explicit `store_id` for public product/recommendation reads.
  Without a store, retain the existing catalog/no-selected-store behavior.
- Keep compare, personal `/me` endpoints, and all management endpoints authenticated.

Frontend:

- Update product, scan/search, analysis, and recommendation API callers so public
  requests can run without a token while signed-in requests retain personalization.
  Reuse the existing fetch helpers; never make the authenticated helper silently
  downgrade protected requests to anonymous requests.
- Pass the selected store ID explicitly on discovery requests; avoid reliance on
  a signed-in account's saved store to obtain prices.
- In `StoreContext.tsx`, load stores and complete loading for guests. Currently
  the signed-out path clears stores and leaves loading true.
- Keep a guest store selection locally under a separate guest cache key. Staff
  assignments and the shopper's selected store remain unrelated.
- Refresh product prices/availability when the selected store changes.

Done when: a fresh signed-out launch can scan/search, view images/details and
saved analysis, select a store, and receive non-personalized recommendations.

## 6. Gate personal features consistently (task 40)

- Introduce one reusable sign-in prompt/action helper for likes, history,
  saved preferences, shopping lists, and compare, including direct route entry.
- Show the prompt on a deliberate action rather than issuing protected API calls
  and displaying a generic 401 error afterward.
- Proposed like-button treatment (not yet decided): keep an unfilled heart
  visible for guests. Tapping it opens a Sign in/Cancel prompt, without changing
  the liked state or sending a like request. Do not show a previous account's
  liked state. An alternative is hiding the heart entirely; await the user's choice.
- Do not record guest scan/view history, fetch personal lists, save preferences,
  or load staff notifications. Clear any previous account's personal state.
- Allow guests to adjust an immediate recommendation query without saving it
  as an account preference; the saved Preferences screen remains restricted.
- Keep Manage hidden for guests and shoppers.

Done when: restricted actions explain the sign-in requirement and offer Sign in
or Cancel, while public browsing continues normally after cancellation.

## 7. Implement guest-to-account transition (task 41)

- Preserve the current product/navigation context when signing in.
- Proposed store rule: if the guest deliberately picked a store, offer to keep
  it for the account or use the account's saved store. Otherwise load the saved store.
  Reuse the existing store-conflict prompt rather than silently overwriting data.
- On sign-out, clear account-derived state and return to guest browsing; do not
  expose the previous person's preferences, lists, history, or store cache.
- Ignore in-flight responses from an old session after sign-out/account switching;
  retain the existing AuthContext session/request version guards.
- Do not create anonymous likes/history/lists or add a guest-data merge system.

## 8. Test the guest flow end to end (task 42)

- API: anonymous discovery succeeds; protected personal/management requests fail;
  explicit store prices work; guest recommendations neither read nor write
  personal records; analysis reads cannot trigger privileged generation.
- UI: cold launch, no store, store selection, denied location permission,
  scan/search/detail/analysis/recommendations, and every restricted action.
- Transition: cancel sign-in, successful sign-in/back navigation, store-choice
  conflict, sign-out, a second account, and late responses from the first account.
- Re-run role tests and verify guest support has not weakened staff authorization.

## Review before implementing future work

Please confirm or adjust these proposed defaults:

1. Enter browsing directly as a guest, without a mandatory welcome/sign-in screen.
2. Require sign-in for compare, as specified under Shopper in the finalized roles.
3. Offer a store-choice prompt when an explicit guest selection conflicts with
   the signed-in account's saved store.
4. Keep guest activity temporary; no automatic likes/history/list migration.
5. Choose the guest like-button treatment: visible heart with a sign-in prompt
   (recommended), or hidden heart. Guest analysis and non-personalized
   recommendations are confirmed; profile-based recommendations remain signed-in only.

Other owners' UI, image, location, shopping-list, inventory, and review-reliability
features are integration dependencies, not new NC implementation assignments.
