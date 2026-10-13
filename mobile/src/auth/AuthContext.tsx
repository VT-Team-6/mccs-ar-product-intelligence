import {
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  SignInOutput,
} from "aws-amplify/auth";

import { Hub } from "aws-amplify/utils";
import { getUser } from "../api/general";

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
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<SignInOutput>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  async function refreshUser() {
    try {
            const currentUser = await getCurrentUser();
      setUser(currentUser);
      // Asks our backend who this is. This also creates their row in the users table on first login.
      try {
        const profile = await getUser();
        setIsAdmin(profile.is_admin);
      } catch {
        setIsAdmin(false);
      }
    } catch {
      setUser(null);
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsubscribe = Hub.listen("auth", ({ payload }) => {
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
        setIsAdmin(false);
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
    if (result.isSignedIn) {
      await refreshUser();
    }

    return result;
  }

  async function signOut() {
    await amplifySignOut();
    setUser(null);
    setIsAdmin(false);
  }

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, signIn, signOut }}>
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
