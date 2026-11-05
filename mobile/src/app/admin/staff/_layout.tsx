import { Redirect, Slot } from "expo-router";
import { ActivityIndicator } from "react-native";

import { useAuth } from "@/auth/AuthContext";

// export const unstable_settings = {
//   initialRouteName: "index",
// };

export default function AdminStaffLayout() {
  const { loading, profileLoading, hasPermission } = useAuth();
  if (loading || profileLoading) return <ActivityIndicator />;
  if (
    !hasPermission("manage_store_admins") &&
    !hasPermission("manage_store_buyers")
  )
    return <Redirect href="/" />;
  return <Slot />;
}
