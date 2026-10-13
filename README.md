# mccs-ar-product-intelligence
In-store shopping assistant: AR-enabled product intelligence and comparison

The app runs on **Android and iPhone** (plus a web version for quick testing).
Login uses AWS Amplify, so the app **does not run in Expo Go**. Each person builds it once onto their phone or emulator (a "development build"), then uses it like Expo Go.

---

## 1. First-time setup (everyone)

**Get the code**
```bash
git switch develop (For latest development version) (For latest finished sprint release git switch main)
git pull
```

**Backend**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```
Copy `backend/.env.example` to `backend/.env` (it includes the Cognito settings). Then either:
- keep `USE_LOCAL_DEV_DB=1` to use the local Docker database, or
- set `DATABASE_URL` to another database (e.g. RDS, which also needs `?sslmode=require`).

Without one of these the backend refuses to start.

**Mobile**
```bash
cd mobile
npm install
```
Copy `mobile/.env.example` to `mobile/.env` and **delete the `EXPO_PUBLIC_API_URL` line**, so the app finds your computer's backend automatically.

---

## 2. Test Application on your device

### Android
_TODO: Android setup steps (to be added by an Android teammate)._

### iPhone (Mac only)
1. Install **Xcode** from the App Store. Open it once, then sign in under **Xcode → Settings → Accounts** with a free Apple ID.
2. **Simulator:** `npx expo run:ios`
   **Or a real iPhone:**
   - Turn on Settings → Privacy & Security → **Developer Mode**.
   - Plug the phone in, then run `npx expo run:ios --device`.
   - In Xcode, if it asks, set **Signing & Capabilities → Team → Personal Team**.
   - On the phone, go to Settings → General → VPN & Device Management and **Trust** the developer.
   - With a free Apple ID the app expires after **7 days**. Rerun the command to renew it.

### Web (no install)
`npx expo start`, then press `w`.

**Rebuild** only when a package with native code is added. Otherwise, use step 3.

---

## 3. Run the project (every time)
Use three terminals:

1. **Database** (open Docker Desktop first):
```bash
   cd backend
   docker compose up -d
```
2. **Backend:**
```bash
   cd backend
   source .venv/bin/activate        # Windows: .venv\Scripts\activate
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
3. **App:**
```bash
   cd mobile
   npx expo start
```
   Then open the app on your device, or press `i` (iOS Simulator) or `w` (web).

A real phone must be on the **same Wi-Fi** as your computer.

---

## Database notes
- Schema and seed data live in `backend/db/`: `migrations/` runs before `seeds/`.
- Init scripts only run on a fresh database. After adding or editing a `.sql` file, run:
```bash
  docker compose down -v
  docker compose up -d
```
  This **erases all local data**, including users and admins.

## Admin accounts
Everyone is a regular user by default. To make an account an admin, log in once in the app, then from `backend`:
```bash
docker compose exec db psql -U mccs -d mccs -c "UPDATE users SET is_admin = true WHERE email = 'you@email.com';"
```
Log out and back in to see the **Admin** tab.

## Troubleshooting
- **"Could not connect to development server":** make sure `npx expo start` is running and your phone is on the same Wi-Fi. Then reopen the app.
- **Admin list or products won't load:** check the backend terminal for errors, and confirm Docker is running and `backend/.env` has the Cognito lines.
- **App crashes on launch on iOS 27:** handled by `mobile/plugins/with-ios-scene-delegate.js`. If it happens, rebuild with `npx expo prebuild --platform ios --clean` then `npx expo run:ios`. Remove the plugin after upgrading to Expo SDK 58.
- **Google sign-in with an email that already has an email/password account** currently fails to load the profile. Use the same login method each time.
