import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "@/auth/AuthContext";

type LoginProps = {
  onToRegistration: () => void;
  onToVerification: (email: string) => void;
};

export default function LoginForm({
  onToRegistration,
  onToVerification,
}: LoginProps) {
  const { signIn } = useAuth();

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

  function handleGoogleLogin() {
    return;
  }

  return (
    <View style={styles.card}>
      <View style={styles.logoPlaceholder}>
        <Text style={styles.logoText}>LOGO</Text>
      </View>

      <Text style={styles.title}>MCCS Product Intelligence</Text>
      <Text style={styles.subtitle}>
        Sign in to save preferences and history
      </Text>

      <Pressable style={styles.googleButton} onPress={handleGoogleLogin}>
        <Text style={styles.googleButtonText}>▢ Continue with Google</Text>
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
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Pressable style={styles.forgotPassword}>
        <Text style={styles.forgotPasswordText}>Forgot password?</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.primaryButton, loading && styles.disabledButton]}
        onPress={handleLogin}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator />
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
        <Pressable style={styles.guestButton}>
          <Text style={styles.guestButtonText}>
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

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },

  logoPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: "#eeeeee",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 12,
  },

  logoText: {
    fontSize: 10,
    color: "#999999",
  },

  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    color: "#181818",
  },

  subtitle: {
    marginTop: 4,
    marginBottom: 24,
    fontSize: 12,
    textAlign: "center",
    color: "#777777",
  },

  googleButton: {
    height: 44,
    borderWidth: 1,
    borderColor: "#d0d0d0",
    borderRadius: 6,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },

  googleButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#222222",
  },

  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18,
  },

  divider: {
    flex: 1,
    height: 1,
    backgroundColor: "#dedede",
  },

  dividerText: {
    marginHorizontal: 12,
    fontSize: 10,
    color: "#888888",
  },

  label: {
    fontSize: 11,
    color: "#555555",
    marginBottom: 5,
  },

  input: {
    height: 42,
    borderWidth: 1,
    borderColor: "#cccccc",
    borderRadius: 5,
    backgroundColor: "#ffffff",
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
    color: "#555555",
  },

  error: {
    fontSize: 12,
    color: "#b00020",
    marginBottom: 10,
  },

  primaryButton: {
    height: 44,
    borderRadius: 5,
    backgroundColor: "#111111",
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
    color: "#777777",
  },

  switchLink: {
    fontSize: 11,
    fontWeight: "600",
    color: "#222222",
  },

  guestSection: {
    marginTop: 100,
  },

  guestButton: {
    height: 42,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#cccccc",
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },

  guestButtonText: {
    fontSize: 12,
    color: "#666666",
  },

  guestDescription: {
    marginTop: 8,
    textAlign: "center",
    fontSize: 10,
    color: "#999999",
  },
});
