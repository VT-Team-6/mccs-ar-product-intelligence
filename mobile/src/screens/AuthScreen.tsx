import EmailVerification from "@/components/authentication/EmailVerification";
import LoginForm from "@/components/authentication/LoginForm";
import PasswordReset from "@/components/authentication/PasswordReset";
import RegisterForm from "@/components/authentication/RegisterForm";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

export default function AuthScreen() {
  const [authMode, setAuthMode] = useState<
    "login" | "register" | "verify" | "passwordReset"
  >("login");
  const [verificationEmail, setVerificationEmail] = useState<string>("");

  function toVerification(email: string) {
    setVerificationEmail(email);
    setAuthMode("verify");
  }

  return (
    <View style={styles.container}>
      {authMode === "verify" ? (
        <EmailVerification
          email={verificationEmail}
          onBackToLogin={() => setAuthMode("login")}
        />
      ) : authMode === "register" ? (
        <RegisterForm
          onBackToLogin={() => setAuthMode("login")}
          onToVerification={toVerification}
        />
      ) : authMode === "passwordReset" ? (
        <PasswordReset onBack={() => setAuthMode("login")} />
      ) : (
        <LoginForm
          onToRegistration={() => setAuthMode("register")}
          onToVerification={toVerification}
          onToPasswordReset={() => setAuthMode("passwordReset")}
        />
      )}
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
});
