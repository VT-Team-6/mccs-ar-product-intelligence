import { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import AuthScreen from "../screens/AuthScreen";

export default function AuthenticatedApp({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return null; // we should replace this with a proper loading screen later
  }
  if (user) {
    return <>{children}</>;
  } else {
    return <AuthScreen />;
  }
}
