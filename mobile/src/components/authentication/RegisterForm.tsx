import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { signUp } from "aws-amplify/auth";

type RegisterProps = {
  onBackToLogin: () => void;
  onToVerification: (email: string) => void;
};

export default function RegisterForm({
  onBackToLogin,
  onToVerification,
}: RegisterProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setError("");
      setLoading(true);

      const result = await signUp({
        username: email.trim(),
        password,
        options: {
          userAttributes: {
            email: email.trim(),
          },
        },
      });

      onToVerification(email.trim());
    } catch (err) {
      console.error(err);
      setError("Unable to create account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.logoPlaceholder}>
        <Text style={styles.logoText}>LOGO</Text>
      </View>

      <Text style={styles.title}>Create your account</Text>

      <Text style={styles.subtitle}>
        Save preferences, history, and liked products
      </Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        placeholder="username@example.com"
        placeholderTextColor="#999999"
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
        placeholderTextColor="#999999"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Text style={styles.label}>Confirm password</Text>
      <TextInput
        style={styles.input}
        placeholder="••••••••"
        placeholderTextColor="#999999"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.primaryButton, loading && styles.disabledButton]}
        onPress={handleRegister}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.primaryButtonText}>Create account</Text>
        )}
      </Pressable>

      <View style={styles.switchContainer}>
        <Text style={styles.switchText}>Already have an account? </Text>

        <Pressable onPress={onBackToLogin}>
          <Text style={styles.switchLink}>Sign in</Text>
        </Pressable>
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
    color: "#181818",
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
});
