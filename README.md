# mccs-ar-product-intelligence

In-store shopping assistant: AR-enabled product intelligence and comparison

Run the project
Get latest code: git switch develop then git pull
Database (open Docker Desktop first): cd backend then docker compose up -d
Schema and seed data live in backend/db/: migrations/ runs before seeds/.
Init scripts only run the first time, so after adding or editing a .sql file
run docker compose down -v then docker compose up -d to rebuild the volume.
Backend config: copy backend/.env.example to backend/.env, then set
USE_LOCAL_DEV_DB=1 for the local docker database, or DATABASE_URL to point at
another database (e.g. RDS, which also needs ?sslmode=require). Without one of
these the backend refuses to start rather than guessing a database.
Backend: cd backend then uvicorn main:app --reload
Frontend: cd mobile then npx expo start, and scan the QR code with your phone (Expo Go)
On their first run you will need to run pip install -r requirements.txt in backend and npm install in mobile.
