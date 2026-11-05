import { Redirect, Slot } from "expo-router";
import { ActivityIndicator } from "react-native";

import { useAuth } from "@/auth/AuthContext";

// export const unstable_settings = {
//   initialRouteName: "index",
// };

export default function AdminInventoryLayout() {
  const { loading, profileLoading, hasPermission } = useAuth();
  if (loading || profileLoading) return <ActivityIndicator />;
  if (!hasPermission("manage_stock") && !hasPermission("manage_inventory"))
    return <Redirect href="/" />;
  return <Slot />;
}
