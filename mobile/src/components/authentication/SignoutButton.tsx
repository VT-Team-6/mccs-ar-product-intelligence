import { useAuth } from "@/auth/AuthContext";
import { Button } from "expo-router/build/react-navigation";
import { Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { BottomTabInset, Spacing, type ThemeColor } from "@/constants/theme";
import { ThemedText } from "../themed-text";

export default function SignoutButton() {
  const { signOut } = useAuth();
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <Pressable style={styles.signOutButton} onPress={signOut}>
      <ThemedText style={styles.signOutText}>Sign Out</ThemedText>
    </Pressable>
  );
}

function createStyles(theme: Record<ThemeColor, string>) {
  return StyleSheet.create({
    signOutButton: {
      backgroundColor: theme.backgroundSelected,
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },

    signOutText: {
      fontSize: 10,
      fontWeight: "600",
    },
  });
}
