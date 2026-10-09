import { AnimatedSplashOverlay } from "@/components/animated-icon";
import "@/auth/amplify"; // configures amplify for authentication

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";

import AppTabs from "@/components/app-tabs";
import { AuthProvider } from "../auth/AuthContext";
import AuthenticatedApp from "../auth/AuthenticatedApp";

SplashScreen.preventAutoHideAsync();
// Keeps the tabs underneath pages like /product/1, so Back has somewhere to go
export const unstable_settings = { anchor: "(tabs)" };

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <AnimatedSplashOverlay />
        <AuthenticatedApp>
          <Stack screenOptions={{ headerShown: false }} />
        </AuthenticatedApp>
      </AuthProvider>
    </ThemeProvider>
  );
}
