import Constants from 'expo-constants';

// The backend runs on the same computer as the Expo dev server.
// On a phone, hostUri looks like "192.168.1.25:8081", so we take the
// computer's address from it and use the backend's port, 8000.
// In the browser there is no hostUri, so it falls back to localhost.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';

// Set EXPO_PUBLIC_API_URL to point the app at a different backend (like AWS later).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? `http://${devHost}:8000`;