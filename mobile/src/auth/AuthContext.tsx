import {
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  SignInOutput,
} from "aws-amplify/auth";

import { Hub } from "aws-amplify/utils";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

type AuthContextType = {
  user: unknown | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<SignInOutput>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);

  async function refreshUser() {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      console.log("Auth event:", payload.event);

      if (
        payload.event === "signInWithRedirect" ||
        payload.event === "signedIn"
      ) {
        refreshUser();
      }

      if (payload.event === "signInWithRedirect_failure") {
        console.error("Google redirect sign-in failed:", payload.data);
      }

      if (payload.event === "signedOut") {
        setUser(null);
      }
    });

    refreshUser();

    return unsubscribe;
  }, []);

  async function signIn(email: string, password: string) {
    const result = await amplifySignIn({
      username: email,
      password,
    });
    console.log(result);
    if (result.isSignedIn) {
      await refreshUser();
    }

    return result;
  }

  async function signOut() {
    await amplifySignOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
