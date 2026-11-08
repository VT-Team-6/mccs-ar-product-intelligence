import { useEffect, useRef, useState } from "react";
import { Alert, Image, Linking, Platform, Pressable, StyleSheet, View } from "react-native";
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
import { BottomTabInset, Brand, MaxContentWidth, Spacing, type ThemeColor } from "@/constants/theme";
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
      {/* Navy header, edge to edge, under the status bar */}
      <View style={styles.header}>
        <SafeAreaView edges={["top"]} style={styles.centered}>
          <View style={styles.brandRow}>
            <View>
              <ThemedText style={styles.wordmark}>MCCS</ThemedText>
              <ThemedText style={styles.tagline}>PRODUCT INTELLIGENCE</ThemedText>
            </View>
            <SignoutButton />
          </View>

          {/* The shared store sheet opens on top */}
          <Pressable
            onPress={() => openStoreSelector()}
            style={({ pressed }) => [styles.storeBar, pressed && { opacity: 0.7 }]}
          >
            <ThemedText style={styles.storeLabel}>{store ? "Shopping at" : "Store"}</ThemedText>
            <ThemedText style={styles.storeName} numberOfLines={1}>
              {store ? store.name : "Choose a store"}
            </ThemedText>
            <ThemedText style={styles.storeChevron}>▾</ThemedText>
          </Pressable>
        </SafeAreaView>
      </View>
      <View style={styles.redStripe} />

      {/* Main content */}
      <View style={[styles.content, styles.centered]}>
        {/* Chesty's welcome tip */}
        <View style={styles.chestyCard}>
          <Image
            source={require("@/assets/images/chesty.png")}
            style={styles.chestyImage}
            resizeMode="contain"
            accessibilityLabel="Chesty, the MCCS bulldog"
          />
          <View style={styles.chestyText}>
            <ThemedText style={styles.chestyTitle}>Hey, I'm Chesty!</ThemedText>
            <ThemedText style={styles.chestyTip}>
              Scan a shelf tag and I'll show you prices, reviews and better picks for you.
            </ThemedText>
          </View>
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
          Align the QR code within the frame
        </ThemedText>
      </View>

      {/* Actions */}
      <View
        style={[
          styles.actions,
          styles.centered,
          { paddingBottom: insets.bottom + BottomTabInset + Spacing.three },
        ]}
      >
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.85 }]}
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
          style={({ pressed }) => [styles.secondaryButton, pressed && { opacity: 0.7 }]}
          onPress={() => !needsStore() && router.push("/search")}
        >
          <ThemedText style={styles.secondaryButtonText}>
            Enter product manually
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={() => !needsStore() && router.push("/advanced-search" as Href)}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <ThemedText style={styles.advancedLink}>
            Not sure what you need?{" "}
            <ThemedText style={styles.advancedLinkStrong}>Try advanced search</ThemedText>
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

// Brand colors (navy, red) stay the same in light and dark mode.
// Everything else comes from the theme, so the screen still follows dark mode.
function createStyles(theme: Record<ThemeColor, string>) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },

    // Keeps the layout phone-width and centered on a wide browser window
    centered: {
      width: "100%",
      maxWidth: MaxContentWidth,
      alignSelf: "center",
    },

    header: {
      backgroundColor: Brand.navy,
      paddingHorizontal: Spacing.four,
      paddingBottom: Spacing.three,
    },

    brandRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      // On web the tab bar floats at the top, so start the header below it
      paddingTop: Platform.OS === "web" ? Spacing.six : Spacing.two,
    },

    wordmark: {
      color: "#ffffff",
      fontSize: 26,
      lineHeight: 30,
      fontWeight: "900",
      letterSpacing: 3,
    },

    tagline: {
      color: "rgba(255,255,255,0.75)",
      fontSize: 10,
      lineHeight: 14,
      fontWeight: "700",
      letterSpacing: 1.5,
    },

    storeBar: {
      marginTop: Spacing.three,
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.two,
      backgroundColor: Brand.navyLight,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    storeLabel: {
      fontSize: 13,
      color: "rgba(255,255,255,0.7)",
    },
    storeName: {
      flex: 1,
      fontSize: 15,
      fontWeight: "700",
      color: "#ffffff",
    },
    storeChevron: {
      fontSize: 14,
      color: "#ffffff",
    },

    redStripe: {
      height: 4,
      backgroundColor: Brand.red,
    },

    content: {
      flex: 1,
      paddingHorizontal: Spacing.four,
      paddingTop: Spacing.three,
      gap: Spacing.three,
    },

    chestyCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.three,
      backgroundColor: theme.backgroundElement,
      borderRadius: 16,
      padding: Spacing.three,
    },

    chestyImage: {
      width: 80,
      height: 88,
    },

    chestyText: {
      flex: 1,
      gap: 2,
    },

    chestyTitle: {
      fontSize: 16,
      fontWeight: "800",
      color: theme.text,
    },

    chestyTip: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.textSecondary,
    },

    cameraContainer: {
      flex: 1,
      backgroundColor: Brand.navy,
      borderRadius: 18,
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
      padding: Spacing.three,
    },

    permissionText: {
      fontSize: 13,
      color: "#ffffff",
    },

    permissionTitle: {
      fontSize: 16,
      fontWeight: "700",
      textAlign: "center",
      color: "#ffffff",
    },

    permissionDescription: {
      fontSize: 13,
      textAlign: "center",
      maxWidth: 260,
      lineHeight: 19,
      color: "rgba(255,255,255,0.8)",
    },

    permissionButton: {
      backgroundColor: Brand.red,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
    },

    permissionButtonText: {
      color: "#ffffff",
      fontSize: 14,
      fontWeight: "700",
    },

    scanHint: {
      fontSize: 12,
      textAlign: "center",
      color: theme.textSecondary,
      marginTop: -Spacing.two,
    },

    actions: {
      paddingHorizontal: Spacing.four,
      paddingTop: Spacing.two,
      gap: 10,
    },

    primaryButton: {
      height: 52,
      backgroundColor: Brand.red,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },

    primaryButtonText: {
      color: "#ffffff",
      fontSize: 16,
      fontWeight: "800",
    },

    secondaryButton: {
      height: 50,
      backgroundColor: theme.background,
      borderWidth: 2,
      borderColor: Brand.navy,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },

    secondaryButtonText: {
      fontSize: 15,
      fontWeight: "700",
      color: theme.text,
    },

    advancedLink: {
      fontSize: 13,
      textAlign: "center",
      color: theme.textSecondary,
    },

    advancedLinkStrong: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.text,
      textDecorationLine: "underline",
      textDecorationColor: Brand.red,
    },
  });
}