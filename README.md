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

## Admin users
The Admin tab is visibly only if your user in the database has the `is_admin` field set to true.
To make yourself and admin:

1. Sign into the app once. The backend creates your `users` row on your first authenticated
   request, so it must exist before it can be made an admin.
2. Admin your account using the local docker database from the `backend/db` directory:
   ```bash
   docker exec backend-db-1 psql -U mccs -d mccs -c "UPDATE users SET is_admin = TRUE, updated_at = CURRENT_TIMESTAMP WHERE email = 'YOUR_EMAIL@email.com' RETURNING user_id, email, is_admin;"
   ```
   If not using the local db, run the same UPDATE command with psql.
3. Sign out and back in (or reload the app) to see updates. 
