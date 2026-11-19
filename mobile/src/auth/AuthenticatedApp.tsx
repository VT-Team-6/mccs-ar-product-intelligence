import { Stack } from "expo-router";

import { NotificationsProvider } from "@/components/notification-banner";
import { useAuth } from "./AuthContext";

export default function AppNavigator() {
  const { user, loading, guestBrowsing } = useAuth();
  const signedIn = !!user;
  const canBrowse = signedIn || guestBrowsing;

  if (loading) return null;

  return (
    <NotificationsProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!canBrowse}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={canBrowse}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="search" />
          <Stack.Screen name="advanced-search" />
          <Stack.Screen name="advanced-results" />
          <Stack.Screen name="product" />
          <Stack.Screen name="compare" />
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="admin" />
          </Stack.Protected>
        </Stack.Protected>
      </Stack>
    </NotificationsProvider>
  );
}
