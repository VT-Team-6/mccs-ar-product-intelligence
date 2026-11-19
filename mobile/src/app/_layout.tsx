import { AnimatedSplashOverlay } from "@/components/animated-icon";
import "@/auth/amplify"; // configures amplify for authentication

import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";

import { AuthProvider } from "../auth/AuthContext";
import AppNavigator from "../auth/AuthenticatedApp";
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
          <AppNavigator />
        </StoreProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
