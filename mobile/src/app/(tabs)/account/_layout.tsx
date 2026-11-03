import { Stack } from 'expo-router';

// Holds the Account screen, and the pages it opens on top of it
// (preferences and future profile management).
export default function AccountLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
