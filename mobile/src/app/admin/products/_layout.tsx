import { Redirect, Slot } from "expo-router";
import { ActivityIndicator } from "react-native";

import { useAuth } from "@/auth/AuthContext";

// export const unstable_settings = {
//   initialRouteName: "index",
// };

export default function AdminProductsLayout() {
  const { loading, profileLoading, hasPermission } = useAuth();
  if (loading || profileLoading) return <ActivityIndicator />;
  // Store admins can open it too: they add products for their store and
  // print QR codes. What they can change on each product is checked per screen.
  if (!hasPermission("create_products")) return <Redirect href="/" />;
  return <Slot />;
}
