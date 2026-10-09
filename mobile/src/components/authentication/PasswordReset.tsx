import { confirmResetPassword, resetPassword } from "aws-amplify/auth";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type PasswordResetProps = {
  onBack: () => void;
};

export default function PasswordReset({ onBack }: PasswordResetProps) {
  const [step, setStep] = useState<"email" | "confirm">("email");

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSendCode() {
    try {
      setError("");
      setLoading(true);

      const result = await resetPassword({
        username: email.trim(),
      });

      if (
        result.nextStep.resetPasswordStep === "CONFIRM_RESET_PASSWORD_WITH_CODE"
      ) {
        setStep("confirm");
      }
    } catch (err: any) {
      console.error(err);
      switch (err.name) {
        case "UserNotFoundException":
          setError("No account was found with that email.");
          break;

        case "LimitExceededException":
          setError("Too many attempts. Please wait a little and try again.");
          break;

        default:
          setError("Could not send password reset code.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    try {
      setError("");
      setLoading(true);

      await confirmResetPassword({
        username: email.trim(),
        confirmationCode: code.trim(),
        newPassword,
      });

      onBack();
    } catch (err: any) {
      console.error(err);
      switch (err.name) {
        case "InvalidPasswordException":
          setError(
            "Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.",
          );
          break;

        case "CodeMismatchException":
          setError("The verification code is incorrect.");
          break;

        case "ExpiredCodeException":
          setError("The verification code has expired. Request a new code.");
          break;

        case "LimitExceededException":
          setError("Too many attempts. Please wait a little and try again.");
          break;

        default:
          setError("Could not reset password. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (step === "confirm") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Reset password</Text>

        <Text style={styles.subtitle}>
          Enter the code sent to your email and choose a new password.
        </Text>

        <Text style={styles.label}>Verification code</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
        />

        <Text style={styles.label}>New password</Text>
        <TextInput
          style={styles.input}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="New password"
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryButton, loading && styles.disabledButton]}
          onPress={handleResetPassword}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.primaryButtonText}>Reset password</Text>
          )}
        </Pressable>

        <Pressable onPress={() => setStep("email")}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Forgot password?</Text>

      <Text style={styles.subtitle}>
        Enter your email and we'll send you a password reset code.
      </Text>

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="username@example.com"
        placeholderTextColor="#999999"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.primaryButton, loading && styles.disabledButton]}
        onPress={handleSendCode}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.primaryButtonText}>Send reset code</Text>
        )}
      </Pressable>

      <Pressable onPress={onBack}>
        <Text style={styles.backText}>Back to sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",

    backgroundColor: "#f7f7f7",
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 16,
  },

  title: {
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    color: "#171717",

    marginBottom: 4,
  },

  subtitle: {
    fontSize: 11,
    textAlign: "center",
    color: "#777777",

    marginBottom: 24,
  },

  label: {
    fontSize: 10,
    color: "#666666",

    marginBottom: 4,
  },

  input: {
    height: 42,

    borderWidth: 1,
    borderColor: "#cccccc",
    borderRadius: 5,

    backgroundColor: "#ffffff",
    color: "#181818",

    paddingHorizontal: 12,

    fontSize: 13,

    marginBottom: 12,
  },

  error: {
    fontSize: 11,
    color: "#b00020",

    marginBottom: 10,
  },

  primaryButton: {
    height: 44,

    borderRadius: 5,
    backgroundColor: "#171717",

    alignItems: "center",
    justifyContent: "center",

    marginTop: 2,
  },

  disabledButton: {
    opacity: 0.6,
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  backText: {
    marginTop: 12,

    textAlign: "center",
    fontSize: 10,
    fontWeight: "500",
    color: "#555555",
  },
});
