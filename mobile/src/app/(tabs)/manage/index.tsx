import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth/AuthContext";
import { useNotifications } from "@/components/notification-banner";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SectionLabel } from "@/components/ui/section-label";
import { BottomTabInset, Brand, MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const ROLE_NAME: Record<string, string> = {
  system_admin: "App admin",
  store_admin: "Store manager",
  store_buyer: "Buyer",
  store_clerk: "Clerk",
};

// The Manage tab: everything staff use, in one place, so Account only holds
// the person's own settings. Each row shows only for roles that can use it.
export default function ManagementScreen() {
  const { profile, hasPermission } = useAuth();
  const { unread, refresh } = useNotifications();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Fresh unread count each time the tab opens
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const isManager = hasPermission("manage_inventory");
  const seesSetup =
    hasPermission("create_products") ||
    hasPermission("manage_store_admins") ||
    hasPermission("manage_store_buyers");
  const seesStock = isManager || hasPermission("manage_stock");

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + BottomTabInset + Spacing.three }}>
        <ScreenHeader
          title="Management"
          eyebrow="MCCS"
          subtitle={profile ? ROLE_NAME[profile.role] ?? undefined : undefined}
          back={false}
        />

        <View style={styles.list}>
          {seesSetup && <SectionLabel label="Store setup" />}

          {hasPermission("create_products") && (
            <Row
              label="Manage Products"
              hint={
                hasPermission("manage_products")
                  ? "Add, edit and delete products"
                  : "Add products for your store and print QR codes"
              }
              href="/admin/products"
            />
          )}

          {(hasPermission("manage_store_admins") || hasPermission("manage_store_buyers")) && (
            <Row label="Manage Staff" hint="Add or remove staff" href="/admin/staff" />
          )}

          {seesStock && (
            <SectionLabel label="Stock and orders" style={seesSetup ? styles.groupLabel : undefined} />
          )}

          {seesStock && (
            <Row
              label="Manage Inventory/Stock"
              hint="Stock counts, end-of-day CSV, low-stock levels and buyers"
              href="/admin/inventory"
            />
          )}

          {seesStock && (
            <Row
              label="Reorders"
              hint={
                isManager
                  ? "Low-stock products and their order status"
                  : "Order requests from your stores"
              }
              badge={unread}
              href="/admin/reorders"
            />
          )}
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function Row({ label, hint, href, badge = 0 }: { label: string; hint: string; href: Href; badge?: number }) {
  const router = useRouter();
  const theme = useTheme();
  return (
    <Pressable onPress={() => router.push(href)} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="card" style={[styles.row, { borderColor: theme.border }]}>
        <ThemedView type="card" style={styles.rowText}>
          <ThemedText type="smallBold">{label}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        </ThemedView>
        {badge > 0 && (
          <View style={styles.badge}>
            <ThemedText style={styles.badgeText}>{badge > 99 ? "99+" : String(badge)}</ThemedText>
          </View>
        )}
        <ThemedText themeColor="link" style={styles.chevron}>
          ›
        </ThemedText>
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
  groupLabel: {
    paddingTop: Spacing.two,
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
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    backgroundColor: Brand.red,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#ffffff",
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "800",
  },
  chevron: {
    fontSize: 22,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.6,
  },
});
