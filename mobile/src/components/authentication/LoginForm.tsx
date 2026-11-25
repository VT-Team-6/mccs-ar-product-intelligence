import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/auth/AuthContext";
import { signInWithRedirect } from "aws-amplify/auth";

import { GoogleLogo } from "@/components/ui/google-logo";
import { Brand, Colors } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type LoginProps = {
  onToRegistration: () => void;
  onToVerification: (email: string) => void;
  onToPasswordReset: () => void;
};

export default function LoginForm({
  onToRegistration,
  onToVerification,
  onToPasswordReset,
}: LoginProps) {
  const { signIn, continueAsGuest } = useAuth();
  const theme = useTheme();
  // Colors follow the app theme, so the screen switches with light/dark mode
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    try {
      setError("");
      setLoading(true);
      const result = await signIn(email.trim(), password);
      if (result.nextStep.signInStep === "CONFIRM_SIGN_UP") {
        onToVerification(email.trim());
      }
    } catch (err) {
      console.error(err);
      setError("Incorrect email or password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    try {
      await signInWithRedirect({ provider: "Google" });
    } catch (err) {
      setError("Google sign-in failed.");
      console.error("Google sign-in failed:", err);
    }
  }

  return (
    <View style={styles.card}>
      {/* Placeholder for the app logo (being designed; added later) */}
      <View style={styles.logoPlaceholder}>
        <Text style={styles.logoText}>LOGO</Text>
      </View>

      <Text style={styles.title}>MCCS Product Intelligence</Text>
      <Text style={styles.subtitle}>
        Sign in to save preferences and history
      </Text>

      <Pressable style={styles.secondaryButton} onPress={handleGoogleLogin}>
        <View style={styles.googleRow}>
          <GoogleLogo size={18} />
          <Text style={styles.secondaryButtonText}>Continue with Google</Text>
        </View>
      </Pressable>

      <View style={styles.dividerContainer}>
        <View style={styles.divider} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.divider} />
      </View>

      <Text style={styles.label}>Username or email</Text>
      <TextInput
        style={styles.input}
        placeholder="username@example.com"
        placeholderTextColor={theme.textSecondary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        placeholder="••••••••"
        placeholderTextColor={theme.textSecondary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Pressable style={styles.forgotPassword} onPress={onToPasswordReset}>
        <Text style={styles.forgotPasswordText}>Forgot password?</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.primaryButton, loading && styles.disabledButton]}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={styles.primaryButtonText}>Sign in</Text>
        )}
      </Pressable>

      <View style={styles.switchContainer}>
        <Text style={styles.switchText}>No account? </Text>

        <Pressable onPress={onToRegistration}>
          <Text style={styles.switchLink}>Create one</Text>
        </Pressable>
      </View>

      <View style={styles.guestSection}>
        <Pressable
          style={[styles.secondaryButton, loading && styles.disabledButton]}
          accessibilityRole="button"
          disabled={loading}
          onPress={continueAsGuest}
        >
          <Text style={styles.secondaryButtonText}>
            Continue without signing in
          </Text>
        </Pressable>

        <Text style={styles.guestDescription}>
          Scanning works signed out. History and likes do not.
        </Text>
      </View>
    </View>
  );
}

const makeStyles = (theme: (typeof Colors)["light" | "dark"]) =>
  StyleSheet.create({
    card: {
      width: "100%",
      maxWidth: 420,
      alignSelf: "center",
    },

    logoPlaceholder: {
      width: 52,
      height: 52,
      borderRadius: 10,
      backgroundColor: theme.backgroundElement,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      marginBottom: 12,
    },

    logoText: {
      fontSize: 10,
      color: theme.textSecondary,
    },

    title: {
      fontSize: 20,
      fontWeight: "700",
      textAlign: "center",
      color: theme.text,
    },

    subtitle: {
      marginTop: 4,
      marginBottom: 24,
      fontSize: 12,
      textAlign: "center",
      color: theme.textSecondary,
    },

    secondaryButton: {
      height: 44,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
      backgroundColor: theme.card,
      alignItems: "center",
      justifyContent: "center",
    },

    googleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },

    secondaryButtonText: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.text,
    },

    dividerContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: 18,
    },

    divider: {
      flex: 1,
      height: 1,
      backgroundColor: theme.border,
    },

    dividerText: {
      marginHorizontal: 12,
      fontSize: 10,
      color: theme.textSecondary,
    },

    label: {
      fontSize: 11,
      color: theme.textSecondary,
      marginBottom: 5,
    },

    input: {
      height: 42,
      borderWidth: 1,
      borderColor: theme.border,
      color: theme.text,
      borderRadius: 5,
      backgroundColor: theme.card,
      paddingHorizontal: 12,
      marginBottom: 12,
      fontSize: 14,
    },

    forgotPassword: {
      alignSelf: "flex-end",
      marginTop: -5,
      marginBottom: 16,
    },

    forgotPasswordText: {
      fontSize: 10,
      color: theme.link,
    },

    error: {
      fontSize: 12,
      color: theme.danger,
      marginBottom: 10,
    },

    primaryButton: {
      height: 44,
      borderRadius: 5,
      backgroundColor: Brand.navy,
      alignItems: "center",
      justifyContent: "center",
    },

    disabledButton: {
      opacity: 0.6,
    },

    primaryButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "600",
    },

    switchContainer: {
      flexDirection: "row",
      justifyContent: "center",
      marginTop: 12,
    },

    switchText: {
      fontSize: 11,
      color: theme.textSecondary,
    },

    switchLink: {
      fontSize: 11,
      fontWeight: "600",
      color: theme.link,
    },

    guestSection: {
      marginTop: 100,
    },

    guestDescription: {
      marginTop: 8,
      textAlign: "center",
      fontSize: 10,
      color: theme.textSecondary,
    },
  });
