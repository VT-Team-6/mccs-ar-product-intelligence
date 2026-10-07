import { useAuth } from "@/auth/AuthContext";
import { Button } from "expo-router/build/react-navigation";

export default function SignoutButton() {
  const { signOut } = useAuth();

  return <Button onPress={signOut}>Sign out</Button>;
}
