import "@/auth/amplify"; // configures amplify for authentication

import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import AppTabs from "@/components/app-tabs";
import { AuthProvider } from "../auth/AuthContext";
import AuthenticatedApp from "../auth/AuthenticatedApp";

SplashScreen.preventAutoHideAsync();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <AnimatedSplashOverlay />
        <AuthenticatedApp>
          <AppTabs />
        </AuthenticatedApp>
      </AuthProvider>
    </ThemeProvider>
  );
}
