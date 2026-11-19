import { Redirect, Slot } from "expo-router";
import { ActivityIndicator } from "react-native";

import { useAuth } from "@/auth/AuthContext";

// Reorders, order requests and sending them: for store managers and buyers.
// These sit outside the tabs (like Inventory), so the tab bar is hidden here.
export default function AdminReordersLayout() {
  const { loading, profileLoading, hasPermission, profile } = useAuth();
  if (loading || profileLoading) return <ActivityIndicator />;
  if (profile?.role !== "store_buyer" && !hasPermission("manage_inventory"))
    return <Redirect href="/" />;
  return <Slot />;
}
