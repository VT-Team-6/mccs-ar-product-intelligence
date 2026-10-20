import {
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  SignInOutput,
} from "aws-amplify/auth";

import { Hub } from "aws-amplify/utils";
import { getUser, type User } from "../api/general";

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
  /**
   * `true` = confirmed admin, `false` = confirmed non-admin,
   * `undefined` = not loaded yet or temporarily unavailable.
   */
  isAdmin: boolean | undefined;
  /** The signed-in user's row from our backend, once it has loaded. */
  profile: User | null;
  /** Asks the backend again, for screens that need to recover from a transient failure. */
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<SignInOutput>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | undefined>(undefined);
  const [profile, setProfile] = useState<User | null>(null);

  async function loadProfile(): Promise<User | null> {
    try {
      return await getUser();
    } catch {
      return null;
    }
  }

  // A failure here is usually a transient 401 (for example a token minted
  // seconds in the future), so try once more before giving up.
  async function loadProfileWithRetry(): Promise<User | null> {
    return (await loadProfile()) ?? (await loadProfile());
  }

  async function refreshUser() {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
      // Asks our backend who this is. This also creates their row in the users table on first login.
      const loaded = await loadProfileWithRetry();
      if (loaded) {
        setProfile(loaded);
        setIsAdmin(loaded.is_admin);
      } else {
        // Unknown, not "not an admin": a later refresh can still resolve it.
        setIsAdmin(undefined);
      }
    } catch {
      setUser(null);
      setProfile(null);
      setIsAdmin(undefined);
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
        setProfile(null);
        // No user is signed in, so the role is unknown rather than "not an admin"
        setIsAdmin(undefined);
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
    setProfile(null);
    setIsAdmin(undefined);
  }

  // Refresh the profile on first load, if we haven't already loaded it. 
  // This is important for the case where the user has just signed in and we haven't yet asked the backend who they are.
  async function refreshProfile() {
    const loaded = await loadProfileWithRetry();
    if (loaded) {
      setProfile(loaded);
      setIsAdmin(loaded.is_admin);
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, isAdmin, profile, refreshProfile, signIn, signOut }}>
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
