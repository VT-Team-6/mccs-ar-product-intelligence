# mccs-ar-product-intelligence

In-store shopping assistant: AR-enabled product intelligence and comparison

## Project Setup
1. Get latest code: `git switch develop` then `git pull`
2. Setup the database: with the Docker Engine running, run `docker compose up -d` from the `/backend` folder.
Schema and seed data live in backend/db/: migrations/ runs before seeds/.
Init scripts only run the first time, so after adding or editing a .sql file.
run `docker compose down -v` then `docker compose up -d` to rebuild the volume.
1. Setup .env files: Within both the frontend and backend, create a `.env` file and copy the contents of the respective `.env.example` file into it. For `EXPO_PUBLIC_API_URL` in the frontend, make sure to change the value to your actual IP like so: `http://your.ip.here:8000`. Use `ipconfig` on powershell, `ip a` on bash, `ifconfig` on macOS, or just https://whatismyipaddress.com/ to find you ip. Run `npx expo start -c` to refresh expo after `.env` update.
2. For the backend .env, set `USE_LOCAL_DEV_DB=1` if you are using the local docker database, otherwise set your `DATABASE_URL` to point at another database (e.g. RDS, which also needs ?sslmode=require).
3. From the `/backend` directory, run `pip install -r requirements.txt`.
4. From the `/mobile` directory, run `npm install`.

## Running the backend:
1. Ensure the database container is running if you are using the local docker database.
2. Run `uvicorn main:app --host 0.0.0.0 --reload`

## Running the frontend: 
### Expo Go (Likely will not work with new authentication system)
1. `cd mobile`
2. run `npx expo start`
3. scan the QR code with your phone from the Expo Go app
### Android 
1. `cd mobile`
2. Ensure your phone is either connected with a USB cable, or you have an android emulator actively running. If using your phone, ensure USB debugging is turned on, and you have clicked allow.
3. run `npm expo run:android`. This will take a while the first time you run the command.
4. Once the build is complete, the app should launch on your phone. The frontend will update on saves, just like with expo go. 
### IOS
If someone with running on iphone could update this that would be great

### After updating a native module (or changing app.json plugins)

`app.json` was updated to support location services with `expo-location`, so rebuild is required to see changes. 

1. `npx expo prebuild --clean` (regenerates `android/` and `ios/`)
2. `npm run android` (or `npx eas-cli@latest build --profile development`)


## Roles and permissions

Access is decided by two things, and both are needed:

- **Capability** — `users.role` is one global role, mapped to permissions in `auth.ROLE_PERMISSIONS`.
- **Scope** — `user_stores` lists which stores that role applies to.

| Role | Permissions |
|---|---|
| `user` | none |
| `store_buyer` | `manage_stock` |
| `store_admin` | `manage_stock`, `manage_inventory`, `manage_store_buyers` |
| `system_admin` | everything above plus `manage_products`, `aggregate_reviews`, `manage_all_stores`, `manage_store_admins` |

`manage_stock` therefore means "may change stock at my stores", not "at any store". Only
`manage_all_stores` (`system_admin`) bypasses the store list.

The **Account** tab shows an admin row per permission you hold, so a role is visible as soon as it
is applied:

| Row | Shown for | Screen |
|---|---|---|
| Manage Products | `manage_products` | `/admin/products` |
| Manage Inventory/Stock | `manage_inventory` or `manage_stock` | `/admin/inventory` |
| Manage Staff | `manage_store_admins` or `manage_store_buyers` | `/admin/staff` |

Admin screens are not their own bottom tab. You sign in to the normal shopper view and open them
from Account.

### Granting `store_buyer` / `store_admin` in the app

This is the intended path and needs no SQL.

1. The person signs into the app once. The backend creates their `users` row on their first
   authenticated request, so the account must exist before it can be given a role.
2. Sign in as someone with **Manage Staff** access and open **Account → Manage Staff**.
3. Pick the store, choose **+ Add staff**, search that person's email, pick their role, and save.
4. They sign out and back in (or reload the app) to see the new rows on Account.

Who can grant what:

- `system_admin` can grant `store_buyer` or `store_admin` at any store.
- `store_admin` can grant `store_buyer` only, and only at stores assigned to them.
- Nobody can change their own access.

Removing someone from **Current staff** deletes their assignment for that store only. Their
shopper account and their access at other stores are untouched.

### Granting `system_admin` (first admin, or a new one)

`system_admin` is deliberately not assignable through the API — it is the role that can assign
everything else, so it is seeded directly in the database. Use the local docker database:

```bash
docker exec backend-db-1 psql -U mccs -d mccs -c "UPDATE users SET role = 'system_admin', updated_at = CURRENT_TIMESTAMP WHERE email = 'YOUR_EMAIL@email.com' RETURNING user_id, email, role;"
```

If you are not on the local database, run the same `UPDATE` with `psql` against your
`DATABASE_URL`.

A `system_admin` does not need rows in `user_stores`, because `manage_all_stores` covers every
store. Assignments only matter for staff working a specific store:

```bash
docker exec backend-db-1 psql -U mccs -d mccs -c "INSERT INTO user_stores (user_id, store_id) SELECT u.user_id, s.store_id FROM users u, stores s WHERE u.email = 'STAFF@email.com' AND s.store_id = 1 ON CONFLICT DO NOTHING;"
```

Check what someone currently has:

```bash
docker exec backend-db-1 psql -U mccs -d mccs -c "SELECT u.user_id, u.email, u.role, ARRAY(SELECT store_id FROM user_stores WHERE user_id = u.user_id ORDER BY store_id) AS store_ids FROM users u WHERE u.email = 'YOUR_EMAIL@email.com';"
```

### One global role per user

`users.role` is a single value, so a person cannot be `store_admin` at one store and
`store_buyer` at another. Assigning a role in **Manage Staff** updates that global role: adding
someone as `store_buyer` at a second store also makes them `store_buyer` at the stores they
already had. If someone needs different levels at different stores, fix it in the database with the
`UPDATE` above and keep the store list as the record of where they work.
