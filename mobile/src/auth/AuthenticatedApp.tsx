import { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { useStore } from "../store/StoreContext";
import AuthScreen from "../screens/AuthScreen";

export default function AuthenticatedApp({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const { loading: storeLoading } = useStore();

  // Wait for the store as well as the session. Rendering the tabs first would
  // paint "select a store" for a moment before the saved store arrives.
  if (loading || (user && storeLoading)) {
    return null; // we should replace this with a proper loading screen later
  }
  if (user) {
    return <>{children}</>;
  } else {
    return <AuthScreen />;
  }
}
