import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";

import { authenticatedFetch } from "@/api/client";
import { API_URL } from "@/api/config";
import { recordInteraction } from "@/api/me";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useStore } from "@/store/StoreContext";
import SignoutButton from "@/components/authentication/SignoutButton";

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = createStyles(theme);

  // The one active store, shared with every other screen.
  const { store, loading: storeLoading, openStoreSelector } = useStore();
  // Offers the list once on arrival if nothing is picked yet, so a new shopper
  // isn't stuck at a disabled Scan button. Closing it is respected.
  const offeredStore = useRef(false);

  useEffect(() => {
    if (storeLoading || offeredStore.current) return;
    offeredStore.current = true;
    if (store === null) openStoreSelector();
  }, [store, storeLoading, openStoreSelector]);

  // Prices and stock depend on the store, so scanning or searching needs one first.
  // Returns true (and opens the store list) when no store is chosen yet.
  const needsStore = () => {
    if (store !== null) return false;
    openStoreSelector();
    Alert.alert("Choose a store first", "Prices and stock depend on the store you're shopping at.");
    return true;
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    console.log("Scanned QR:", data);
    console.log("API URL:", API_URL);

    if (!isScanning || isLoading) {
      return;
    }

    setIsScanning(false);
    setIsLoading(true);

    try {
      // Authenticated, so the backend prices the result at the saved store.
      const response = await authenticatedFetch(
        `/api/scan?code=${encodeURIComponent(data)}`,
      );

      const result = await response.json();

      if (!response.ok) {
        Alert.alert(
          "Product not found",
          result.detail ?? "This QR code could not be recognized.",
        );
        return;
      }

      // Opens the shopper product page. "from" makes its Back button return here.
      // The scan is recorded for the History tab; the product page records the
      // view itself. Recording never blocks opening the product.
      recordInteraction(result.product_id, "scanned").catch(() => undefined);
      router.push(`/product/${result.product_id}?from=/` as Href);
    } catch {
      Alert.alert(
        "Connection error",
        "Unable to connect to the product server.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        {/* Top header */}
        <View style={styles.header}>
          <ThemedText style={styles.logoText}>MCCS</ThemedText>

          <SignoutButton />
        </View>

        {/* Main content */}
        <View style={styles.content}>
          <View>
            <ThemedText style={styles.title}>Scan a product</ThemedText>

            <ThemedText style={styles.subtitle}>
              Point your camera at a barcode or QR code
            </ThemedText>
          </View>

          {/* Camera */}
          <View style={styles.cameraContainer}>
            {!permission ? (
              <View style={styles.permissionPlaceholder}>
                <ThemedText style={styles.permissionText}>
                  Loading camera...
                </ThemedText>
              </View>
            ) : permission.granted ? (
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ["qr"],
                }}
                onBarcodeScanned={handleBarcodeScanned}
              />
            ) : permission.canAskAgain ? (
              <View style={styles.permissionPlaceholder}>
                <ThemedText style={styles.permissionTitle}>
                  Camera access required
                </ThemedText>

                <ThemedText style={styles.permissionDescription}>
                  Allow camera access so you can scan product QR codes.
                </ThemedText>

                <Pressable
                  style={styles.permissionButton}
                  onPress={requestPermission}
                >
                  <ThemedText style={styles.permissionButtonText}>
                    Enable camera
                  </ThemedText>
                </Pressable>
              </View>
            ) : (
              <View style={styles.permissionPlaceholder}>
                <ThemedText style={styles.permissionTitle}>
                  Camera permission denied
                </ThemedText>

                <ThemedText style={styles.permissionDescription}>
                  Camera access is disabled. Enable it in your device settings
                  to scan products.
                </ThemedText>

                <Pressable
                  style={styles.permissionButton}
                  onPress={() => Linking.openSettings()}
                >
                  <ThemedText style={styles.permissionButtonText}>
                    Open settings
                  </ThemedText>
                </Pressable>
              </View>
            )}
          </View>

          <ThemedText style={styles.scanHint}>
            Align the barcode within the frame
          </ThemedText>
        </View>

        {/* Actions */}
        <View
          style={[
            styles.actions,
            { paddingBottom: insets.bottom + BottomTabInset + Spacing.one },
          ]}
        >
          {/* One line, so the camera keeps its height. The shared sheet opens on top. */}
          <Pressable
            onPress={() => openStoreSelector()}
            style={({ pressed }) => [styles.storeBar, pressed && { opacity: 0.6 }]}
          >
            <ThemedText style={styles.storeLabel}>{store ? "Shopping at" : "Store"}</ThemedText>
            <ThemedText style={styles.storeName} numberOfLines={1}>
              {store ? store.name : "Choose a store"}
            </ThemedText>
            <ThemedText style={styles.storeChevron}>▾</ThemedText>
          </Pressable>

          <Pressable
            style={styles.primaryButton}
            onPress={() => !needsStore() && setIsScanning(true)}
            disabled={isLoading}
          >
            <ThemedText style={styles.primaryButtonText}>
              {isLoading
                ? "Finding product..."
                : isScanning
                  ? "Scanning..."
                  : "Scan product"}
            </ThemedText>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={() => !needsStore() && router.push("/search")}
          >
            <ThemedText style={styles.secondaryButtonText}>
              Enter product manually
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

// Styles are made from the theme colors, so the screen follows light and dark mode
function createStyles(theme: Record<ThemeColor, string>) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },

    safeArea: {
      flex: 1,
    },

    header: {
      height: 54,
      backgroundColor: theme.background,
      borderBottomWidth: 1,
      borderBottomColor: theme.backgroundSelected,
      paddingHorizontal: Spacing.four,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },

    logoText: {
      fontSize: 16,
      fontWeight: "700",
    },

    content: {
      flex: 1,
      paddingHorizontal: Spacing.four,
      paddingTop: Spacing.four,
    },

    title: {
      fontSize: 22,
      fontWeight: "700",
      marginBottom: 4,
    },

    subtitle: {
      fontSize: 13,
      color: theme.textSecondary,
      marginBottom: Spacing.four,
    },

    cameraContainer: {
      flex: 1,
      backgroundColor: theme.backgroundElement,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },

    camera: {
      width: "100%",
      height: "100%",
    },

    permissionPlaceholder: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },

    permissionText: {
      fontSize: 13,
    },

    permissionTitle: {
      fontSize: 16,
      fontWeight: "700",
      textAlign: "center",
    },

    permissionDescription: {
      fontSize: 13,
      textAlign: "center",
      maxWidth: 260,
      lineHeight: 19,
    },

    // Dark button on light mode, light button on dark mode
    permissionButton: {
      backgroundColor: theme.text,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 7,
    },

    permissionButtonText: {
      color: theme.background,
      fontSize: 14,
      fontWeight: "700",
    },

    scanHint: {
      fontSize: 12,
      textAlign: "center",
      color: theme.textSecondary,
      marginTop: 12,
      marginBottom: 18,
    },

    storeBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.two,
      backgroundColor: theme.backgroundElement,
      borderRadius: Spacing.three,
      paddingVertical: Spacing.two,
      paddingHorizontal: Spacing.three,
    },
    storeLabel: {
      fontSize: 13,
      color: theme.textSecondary,
    },
    storeName: {
      flex: 1,
      fontSize: 15,
      fontWeight: "600",
      color: theme.text,
    },
    storeChevron: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    actions: {
      backgroundColor: theme.background,
      borderTopWidth: 1,
      borderTopColor: theme.backgroundSelected,
      paddingHorizontal: Spacing.four,
      paddingTop: 12,
      gap: 8,
    },

    primaryButton: {
      height: 48,
      backgroundColor: theme.text,
      borderRadius: 7,
      alignItems: "center",
      justifyContent: "center",
    },

    primaryButtonText: {
      color: theme.background,
      fontSize: 15,
      fontWeight: "700",
    },

    secondaryButton: {
      height: 48,
      backgroundColor: theme.background,
      borderWidth: 1,
      borderColor: theme.textSecondary,
      borderRadius: 7,
      alignItems: "center",
      justifyContent: "center",
    },

    secondaryButtonText: {
      fontSize: 15,
      fontWeight: "700",
    },
  });
}