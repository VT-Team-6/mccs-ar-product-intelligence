import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth/AuthContext";
import { useSignInPrompt } from "@/auth/use-sign-in-prompt";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SectionLabel } from "@/components/ui/section-label";
import { BottomTabInset, Brand, MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useStore } from "@/store/StoreContext";

export default function AccountScreen() {
  const { user, profile, profileLoading, signOut, refreshProfile, showSignIn } = useAuth();
  const { store, homeStore, loading: storeLoading, openStoreSelector } = useStore();
  const promptSignIn = useSignInPrompt();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  // Tracks the "Try again" press, and makes the automatic retry happen once
  const [retrying, setRetrying] = useState(false);
  const attempted = useRef(false);

  // Refresh the profile on first load, if we haven't already loaded it. This is important for the case where the user has just signed in and we haven't yet asked the backend who they are.
  useEffect(() => {
    if (!user || profile || profileLoading || attempted.current) return;
    attempted.current = true;
    refreshProfile();
  }, [user, profile, profileLoading, refreshProfile]);

  const retry = async () => {
    setRetrying(true);
    await refreshProfile();
    setRetrying(false);
  };

  const openPreferences = () => {
    if (user) {
      router.push("/account/preferences");
    } else {
      void promptSignIn("Sign in to view and save your preferences.");
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + BottomTabInset + Spacing.three,
        }}
      >
        <ScreenHeader
          title="Account"
          eyebrow="MCCS"
          subtitle={user ? profile?.email : "Browsing as a guest"}
          back={false}
        />

        <View style={styles.list}>
          {/* Staff tools live in the Manage tab */}
          {user && profileLoading ? <ActivityIndicator /> : null}
          {user && !profile && !profileLoading ? (
            <Pressable
              onPress={retry}
              disabled={retrying}
              accessibilityRole="button"
              style={({ pressed }) => pressed && styles.pressed}
            >
              <ThemedView type="card" style={[styles.row, { borderColor: theme.border }]}>
                <ThemedView type="card" style={styles.rowText}>
                  <ThemedText type="smallBold">
                    Could not load your account
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {retrying ? "Trying again…" : "Tap to try again"}
                  </ThemedText>
                </ThemedView>
                {retrying && <ActivityIndicator />}
              </ThemedView>
            </Pressable>
          ) : null}

          <SectionLabel label="Your account" />

          <Row
            label="Preferences"
            hint="Manage your preferences"
            onPress={openPreferences}
          />

          <Row
            label="Shopping store"
            hint={store?.name ?? (storeLoading ? "Loading stores…" : "Choose where you are shopping")}
            onPress={() => openStoreSelector()}
          />
          {user ? (
            <>
              <Row
                label="Home store"
                hint={homeStore?.name ?? (storeLoading ? "Loading home store…" : "Choose the default for your account")}
                onPress={() => openStoreSelector({ home: true, allowClear: true })}
              />
              <Row label="Sign out" onPress={signOut} danger />
            </>
          ) : (
            <Row label="Sign in" onPress={showSignIn} />
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function Row({
  label,
  hint,
  onPress,
  danger = false,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  // Red text, for Sign out
  danger?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="card" style={[styles.row, { borderColor: theme.border }]}>
        <ThemedView type="card" style={styles.rowText}>
          <ThemedText type="smallBold" themeColor={danger ? "danger" : undefined} style={danger && styles.danger}>
            {label}
          </ThemedText>
          {hint && (
            <ThemedText type="small" themeColor="textSecondary">
              {hint}
            </ThemedText>
          )}
        </View>
        <ThemedText themeColor="link" style={styles.chevron}>›</ThemedText>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
    row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  chevron: {
    fontSize: 22,
    fontWeight: "700",
  },
  danger: {
  },
  pressed: {
    opacity: 0.6,
  },
});