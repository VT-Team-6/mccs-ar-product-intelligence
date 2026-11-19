import { Stack, useFocusEffect, usePathname } from "expo-router";
import { useCallback } from "react";
import { useAuth } from "@/auth/AuthContext";

export default function AdminLayout() {
  const { refreshProfile } = useAuth();
  const path = usePathname();

  useFocusEffect(useCallback(() => {
    if (path === "/admin" || path.startsWith("/admin/")) {
      void refreshProfile({ silent: true });
    }
  }, [path, refreshProfile]));

  return <Stack screenOptions={{ headerShown: false }} />;
}
