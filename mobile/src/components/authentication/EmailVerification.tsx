import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { resendSignUpCode } from "aws-amplify/auth";

type VerifyProps = {
  email: string;
  onBackToLogin: () => void;
};

export default function EmailVerification({
  email,
  onBackToLogin,
}: VerifyProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleResend() {
    try {
      setLoading(true);
      setMessage("");
      setError("");

      await resendSignUpCode({
        username: email,
      });

      setMessage("Verification email sent.");
    } catch (err) {
      console.error(err);
      setError("Unable to resend verification email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Verify your email</Text>

        <Text style={styles.description}>We sent a verification email to:</Text>

        <Text style={styles.email}>{email}</Text>

        <Text style={styles.description}>
          Click the verification link in the email, then return here and sign
          in.
        </Text>

        {message ? <Text style={styles.success}>{message}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryButton, loading && styles.disabled]}
          onPress={handleResend}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.primaryButtonText}>
              Resend verification email
            </Text>
          )}
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={onBackToLogin}>
          <Text style={styles.secondaryButtonText}>Back to sign in</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#f8f8f8",
  },

  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },

  title: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 16,
    color: "#181818",
  },

  description: {
    fontSize: 13,
    textAlign: "center",
    color: "#666666",
    marginBottom: 8,
  },

  email: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    color: "#222222",
    marginBottom: 18,
  },

  success: {
    fontSize: 12,
    textAlign: "center",
    color: "#2f6f3e",
    marginBottom: 12,
  },

  error: {
    fontSize: 12,
    textAlign: "center",
    color: "#b00020",
    marginBottom: 12,
  },

  primaryButton: {
    height: 44,
    borderRadius: 5,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },

  secondaryButton: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  secondaryButtonText: {
    color: "#333333",
    fontSize: 13,
    fontWeight: "500",
  },

  disabled: {
    opacity: 0.6,
  },
});
