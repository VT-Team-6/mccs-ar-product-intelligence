import {
  getCurrentUser,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  SignInOutput,
} from "aws-amplify/auth";

import { Hub } from "aws-amplify/utils";
import { getUser, type Permission, type User } from "../api/general";

import {
  createContext,
  useCallback,
  ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type AuthContextType = {
  user: unknown | null;
  loading: boolean;
  profileLoading: boolean;
  hasPermission: (permission: Permission) => boolean;
  /** The signed-in user's row from our backend, once it has loaded. */
  profile: User | null;
  /** Asks the backend again, for screens that need to recover from a transient failure. */
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<SignInOutput>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function loadProfile(): Promise<User | null> {
  try {
    return await getUser();
  } catch {
    return null;
  }
}

// Retry once for transient backend or token-verification failures.
async function loadProfileWithRetry(): Promise<User | null> {
  return (await loadProfile()) ?? (await loadProfile());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<unknown | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState<User | null>(null);
  // Ignore account requests that finish after sign-out or a newer refresh.
  const sessionVersion = useRef(0);
  const profileRequest = useRef(0);

  const refreshUser = useCallback(async () => {
    const version = ++sessionVersion.current;
    const request = ++profileRequest.current;
    setLoading(true);
    setProfileLoading(true);
    setProfile(null);
    try {
      const currentUser = await getCurrentUser();
      if (version !== sessionVersion.current) return;
      setUser(currentUser);
      // Asks our backend who this is. This also creates their row in the users table on first login.
      const loaded = await loadProfileWithRetry();
      if (version === sessionVersion.current && request === profileRequest.current) {
        setProfile(loaded);
      }
    } catch {
      if (version === sessionVersion.current) {
        setUser(null);
        setProfile(null);
      }
    } finally {
      if (version === sessionVersion.current) setLoading(false);
      if (request === profileRequest.current) setProfileLoading(false);
    }
  }, []);

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
        sessionVersion.current++;
        profileRequest.current++;
        setUser(null);
        setProfile(null);
        setLoading(false);
        setProfileLoading(false);
      }
    });

    refreshUser();

    return unsubscribe;
  }, [refreshUser]);

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
    sessionVersion.current++;
    profileRequest.current++;
    setUser(null);
    setProfile(null);
    setLoading(false);
    setProfileLoading(false);
  }

  // Refresh the profile on first load, if we haven't already loaded it. 
  // This is important for the case where the user has just signed in and we haven't yet asked the backend who they are.
  const refreshProfile = useCallback(async () => {
    const version = sessionVersion.current;
    const request = ++profileRequest.current;
    setProfileLoading(true);
    try {
      const loaded = await loadProfileWithRetry();
      if (version === sessionVersion.current && request === profileRequest.current) {
        setProfile(loaded);
      }
    } finally {
      if (request === profileRequest.current) setProfileLoading(false);
    }
  }, []);

  function hasPermission(permission: Permission): boolean {
    return profile?.permissions.includes(permission) ?? false;
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, profileLoading, hasPermission, profile, refreshProfile, signIn, signOut }}>
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
