import { AnimatedSplashOverlay } from "@/components/animated-icon";
import "@/auth/amplify"; // configures amplify for authentication

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";

import { NotificationsProvider } from "@/components/notification-banner";
import { AuthProvider } from "../auth/AuthContext";
import AuthenticatedApp from "../auth/AuthenticatedApp";
import { StoreProvider } from "../store/StoreContext";

SplashScreen.preventAutoHideAsync();
// Keeps the tabs underneath pushed pages like /product/1 and /admin, so Back
// has somewhere to go
export const unstable_settings = { anchor: "(tabs)" };

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <AnimatedSplashOverlay />
        {/* Above the Stack, so every screen shares one active store. The
            splash overlay stays outside it: it does not need the store. */}
        <StoreProvider>
          <AuthenticatedApp>
            {/* Unread count for the Manage tab, and the banner on top of every screen */}
            <NotificationsProvider>
              <Stack screenOptions={{ headerShown: false }} />
            </NotificationsProvider>
          </AuthenticatedApp>
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
