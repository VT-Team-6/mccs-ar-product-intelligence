import { useCallback, useEffect, useRef } from "react";
import { Alert, Animated, Easing, Image, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";

import { ThemedText } from "@/components/themed-text";
import { SEARCH_BAR_HEIGHT, SEARCH_BAR_TOP } from "@/constants/search";
import { BottomTabInset, Brand, MaxContentWidth, Spacing, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useStore } from "@/store/StoreContext";
import SignoutButton from "@/components/authentication/SignoutButton";
import { ShoppingListShortcut } from "@/components/shopping-list-shortcut";
import { RecentlyViewed } from "@/components/recently-viewed";

// The space between the search bar and the tab bar
const DOCK_GAP = 10;

// Home: the header with the store picker, Chesty's tip, the shopping list
// shortcut, and a search bar pinned above the tab bar. The bar opens search,
// the QR scanner, or Ask Chesty (advanced search).
export default function HomeScreen() {
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

  // Opens one of the search bar's destinations, once a store is chosen
  const go = (href: Href) => {
    if (!needsStore()) router.push(href);
  };

  // Opening search: the bar slides from the bottom up to where the search
  // screen's bar sits, while the page fades behind it, then the search screen
  // appears underneath. Looks like one bar moving to the top.
  const dockY = useRef(new Animated.Value(0)).current;
  const cover = useRef(new Animated.Value(0)).current;
  const dockTop = useRef(0);
  const opening = useRef(false);

  // The bar sits a small gap above the tab bar, like Target's. On iOS the
  // native tab bar is already part of the bottom safe area inset, so the inset
  // alone reaches the tab bar's top edge. Android's inset doesn't include it.
  // Recently viewed photos fill the space above the search bar: larger on tall
  // phones, the regular size on short ones
  const { height: screenHeight } = useWindowDimensions();
  const viewedSize = Math.round(Math.min(180, Math.max(96, screenHeight - 664)));

  const dockBottom =
    Platform.OS === "ios" ? insets.bottom + DOCK_GAP : insets.bottom + BottomTabInset + DOCK_GAP;

  const openSearch = () => {
    if (opening.current || needsStore()) return;
    opening.current = true;
    Animated.parallel([
      Animated.timing(dockY, {
        toValue: insets.top + SEARCH_BAR_TOP - dockTop.current,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cover, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start(() => router.push("/find" as Href));
  };

  // Back on Home: the bar returns to its place at the bottom
  useFocusEffect(
    useCallback(() => {
      dockY.setValue(0);
      cover.setValue(0);
      opening.current = false;
    }, [dockY, cover]),
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
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
              Scan a product's QR code or search below, and I'll show you prices, reviews and better picks.
            </ThemedText>
          </View>
        </View>

        {/* Straight into shopping mode, or make a list first */}
        <ShoppingListShortcut />

        {/* Pick up where they left off (signed in, once something's been viewed) */}
        <RecentlyViewed from="/" limit={7} size={viewedSize} />

      </View>

      {/* Fades in behind the bar as it slides up to open search */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.background, opacity: cover }]}
      />

      {/* Search bar pinned just above the tab bar */}
      <Animated.View
        onLayout={(event) => {
          dockTop.current = event.nativeEvent.layout.y;
        }}
        style={[
          styles.searchDock,
          { bottom: dockBottom, transform: [{ translateY: dockY }] },
        ]}
        pointerEvents="box-none"
      >
        <View style={[styles.searchBar, styles.centered]}>
          <Pressable
            onPress={openSearch}
            accessibilityRole="search"
            accessibilityLabel="Search products"
            style={({ pressed }) => [styles.searchField, pressed && { opacity: 0.7 }]}
          >
            <SymbolView
              name={{ ios: "magnifyingglass", android: "search", web: "search" }}
              size={20}
              tintColor={theme.textSecondary}
            />
            <ThemedText style={styles.searchPlaceholder}>Search products</ThemedText>
          </Pressable>
          <Pressable
            onPress={() => go("/scan" as Href)}
            accessibilityRole="button"
            accessibilityLabel="Scan a QR code"
            hitSlop={6}
            style={({ pressed }) => [styles.searchIcon, pressed && { opacity: 0.6 }]}
          >
            <SymbolView
              name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }}
              size={24}
              tintColor={theme.danger}
            />
          </Pressable>
          <Pressable
            onPress={() => go("/advanced-search" as Href)}
            accessibilityRole="button"
            accessibilityLabel="Ask Chesty"
            hitSlop={6}
            style={({ pressed }) => [styles.chestyButton, pressed && { opacity: 0.6 }]}
          >
            <Image
              source={require("@/assets/images/chesty.png")}
              style={styles.chestyButtonImage}
              resizeMode="contain"
            />
          </Pressable>
        </View>
      </Animated.View>
    </View>
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

    // The search bar floats above the tab bar, like a shopping app's
    searchDock: {
      position: "absolute",
      left: 0,
      right: 0,
      paddingHorizontal: Spacing.three,
    },
    searchBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.two,
      paddingLeft: Spacing.three,
      paddingRight: Spacing.two,
      minHeight: SEARCH_BAR_HEIGHT,
      borderRadius: SEARCH_BAR_HEIGHT / 2,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    searchField: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.two,
      paddingVertical: Spacing.three,
    },
    searchPlaceholder: {
      fontSize: 16,
      color: theme.textSecondary,
    },
    searchIcon: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    // Chesty's face in a small navy circle opens Ask Chesty
    chestyButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: Brand.navy,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    chestyButtonImage: {
      width: 34,
      height: 34,
      marginTop: 6,
    },
  });
}