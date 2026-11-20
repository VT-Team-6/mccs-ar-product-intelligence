import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter, type Href } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  clearRecentSearches,
  deleteRecentSearch,
  listRecentSearches,
  recordRecentSearch,
  type RecentSearch,
} from "@/api/me";
import { searchProducts, type Product } from "@/api/products";
import { useAuth } from "@/auth/AuthContext";
import { AskChestyButton } from "@/components/ask-chesty-button";
import { ProductCard } from "@/components/product-card";
import { RecentlyViewed } from "@/components/recently-viewed";
import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { SEARCH_BAR_HEIGHT, SEARCH_BAR_TOP } from "@/constants/search";
import { Brand, MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useStore } from "@/store/StoreContext";

// How many recent searches show before "See more"
const SHORT_LIST = 5;
// Room under the list so its last row can scroll clear of the Ask Chesty button
const ASK_ROOM = 64;

// The search screen, opened from the Home search bar. Before searching,
// signed-in shoppers see their recently viewed products and recent searches.
// Pressing Search shows the results right here, below the same bar. The search
// lives in the address (/find?q=nike), so Back from a product returns to it.
export default function FindScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  // Results are priced at the chosen store, so they reload when it changes
  const { store } = useStore();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const query = (q ?? "").trim();

  const [text, setText] = useState(query);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [showAll, setShowAll] = useState(false);

  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Goes up by one each time "Try again" is pressed, which runs the search again
  const [attempt, setAttempt] = useState(0);

  const loadRecent = useCallback(() => {
    if (!profile) return;
    listRecentSearches()
      .then(setRecent)
      .catch(() => undefined);
  }, [profile]);

  // Refreshes each time the screen shows
  useFocusEffect(
    useCallback(() => {
      if (!profile) return;
      let cancelled = false;
      listRecentSearches()
        .then((rows) => !cancelled && setRecent(rows))
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [profile]),
  );

  // Saves each new search to the signed-in shopper's recent searches, then
  // refreshes the list so it's at the top when they come back to it
  useEffect(() => {
    if (!query || !profile?.user_id) return;
    recordRecentSearch(query)
      .then(loadRecent)
      .catch(() => undefined);
  }, [query, profile?.user_id, loadRecent]);

  // Runs the search whenever the search changes or "Try again" is pressed
  useEffect(() => {
    setError(null);
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setResults([]);
    searchProducts(query, store?.store_id)
      .then((found) => {
        if (!cancelled) setResults(found);
      })
      .catch((problem: unknown) => {
        if (!cancelled) setError(searchErrorMessage(problem));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, attempt, store?.store_id]);

  const search = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setText(trimmed);
    router.setParams({ q: trimmed });
  };

  // Clearing the box goes back to the recent searches
  const changeText = (value: string) => {
    setText(value);
    if (value.trim() === "" && query) router.setParams({ q: "" });
  };

  // Back leaves search in one tap: it closes every search screen on top and
  // returns to the page that opened search (usually Home)
  const leave = () => {
    const state = navigation.getState();
    if (!state) return router.replace("/");
    let below = state.index;
    while (below >= 0 && ["find", "search"].includes(state.routes[below].name)) below--;
    if (below < 0) return router.replace("/");
    navigation.dispatch({ type: "POP", payload: { count: state.index - below } });
  };

  const openProduct = (product: Product) => {
    const back = `/find?q=${encodeURIComponent(query)}`;
    router.push(`/product/${product.product_id}?from=${encodeURIComponent(back)}` as Href);
  };

  const remove = (row: RecentSearch) => {
    setRecent((rows) => rows.filter((other) => other.search_id !== row.search_id));
    deleteRecentSearch(row.search_id).catch(() => undefined);
  };

  const clear = () => {
    setRecent([]);
    clearRecentSearches().catch(() => undefined);
  };

  const shownRecent = showAll ? recent : recent.slice(0, SHORT_LIST);

  // Android moves the results area with KeyboardAvoidingView. iOS keeps the
  // floating button in sync with the keyboard's own animation and height.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    // Moves the button with the keyboard's own timing on iOS
    const follow = (duration: number) => {
      if (Platform.OS === "ios" && duration > 0) {
        LayoutAnimation.configureNext(LayoutAnimation.create(duration, LayoutAnimation.Types.keyboard, "opacity"));
      }
    };
    const shown = Keyboard.addListener(showEvent, (event) => {
      follow(event.duration);
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener(hideEvent, (event) => {
      follow(event.duration);
      setKeyboardHeight(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const android = Platform.OS === "android";
  const bottomInset = keyboardHeight > 0 ? (android ? 0 : keyboardHeight) : insets.bottom;
  const askBottom = bottomInset + Spacing.two;
  const listBottomPadding = { paddingBottom: askBottom + ASK_ROOM };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior={android ? "padding" : undefined}
      enabled={android}
    >
      {/* The search bar on navy, in the spot Home's bar slides up to */}
      <View style={[styles.top, { paddingTop: insets.top + SEARCH_BAR_TOP }]}>
        <View style={[styles.topRow, styles.column]}>
          <BackButton iconOnly onPress={leave} />
          <View style={[styles.bar, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <SymbolView
              name={{ ios: "magnifyingglass", android: "search", web: "search" }}
              size={20}
              tintColor={theme.textSecondary}
            />
            <TextInput
              value={text}
              onChangeText={changeText}
              onSubmitEditing={() => search(text)}
              autoFocus={query === ""}
              placeholder="Search products"
              placeholderTextColor={theme.textSecondary}
              returnKeyType="search"
              autoCorrect={false}
              clearButtonMode="while-editing"
              accessibilityLabel="Search products"
              style={[styles.input, { color: theme.text }]}
            />
            <Pressable
              onPress={() => router.push("/scan" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Scan a QR code"
              hitSlop={6}
              style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
            >
              <SymbolView
                name={{ ios: "qrcode.viewfinder", android: "qr_code_scanner", web: "qr_code_scanner" }}
                size={24}
                tintColor={theme.danger}
              />
            </Pressable>
            <AskChestyButton onPress={() => router.push("/advanced-search" as Href)} />
          </View>
        </View>
      </View>
      <View style={styles.stripe} />

      <View style={styles.screen}>
        {query !== "" ? (
          <FlatList
            data={results}
            keyExtractor={(product) => String(product.product_id)}
            renderItem={({ item }) => <ProductCard product={item} onPress={() => openProduct(item)} />}
            // Full width, so the scroll bar sits at the screen's edge
            style={styles.screen}
            contentContainerStyle={[styles.results, styles.column, listBottomPadding]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={
              !loading && !error && results.length > 0 ? (
                <ThemedText themeColor="textSecondary">{`Results for "${query}"`}</ThemedText>
              ) : null
            }
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator size="large" style={styles.loading} />
              ) : error ? (
                <View style={styles.message}>
                  <ThemedText themeColor="textSecondary">{error}</ThemedText>
                  <Pressable onPress={() => setAttempt((count) => count + 1)} hitSlop={8}>
                    <ThemedText type="linkPrimary">Try again</ThemedText>
                  </Pressable>
                </View>
              ) : (
                <ThemedText themeColor="textSecondary">{`No products match "${query}".`}</ThemedText>
              )
            }
          />
        ) : (
          <ScrollView
            style={styles.screen}
            contentContainerStyle={[styles.body, styles.column, listBottomPadding]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <RecentlyViewed from="/find" />

            {recent.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionTop}>
                  <ThemedText style={styles.sectionTitle}>Recently searched</ThemedText>
                  <Pressable onPress={clear} hitSlop={8}>
                    <ThemedText type="linkPrimary">Clear</ThemedText>
                  </Pressable>
                </View>
                {shownRecent.map((row) => (
                  <View key={row.search_id} style={styles.recentRow}>
                    <Pressable
                      onPress={() => search(row.query)}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for ${row.query}`}
                      style={({ pressed }) => [styles.recentMain, pressed && styles.pressed]}
                    >
                      <SymbolView
                        name={{ ios: "clock.arrow.circlepath", android: "history", web: "history" }}
                        size={20}
                        tintColor={theme.textSecondary}
                      />
                      <ThemedText style={styles.recentText} numberOfLines={1}>
                        {row.query}
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => remove(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${row.query}`}
                      hitSlop={10}
                      style={({ pressed }) => pressed && styles.pressed}
                    >
                      <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={16} tintColor={theme.textSecondary} />
                    </Pressable>
                  </View>
                ))}
                {recent.length > SHORT_LIST && (
                  <Pressable onPress={() => setShowAll((was) => !was)} style={styles.more} hitSlop={8}>
                    <ThemedText themeColor="textSecondary">{showAll ? "See less ▴" : "See more ▾"}</ThemedText>
                  </Pressable>
                )}
              </View>
            )}

          </ScrollView>
        )}

        <View pointerEvents="box-none" style={[styles.askBar, { bottom: askBottom }]}>
          <Pressable
            onPress={() => router.push("/advanced-search" as Href)}
            accessibilityRole="button"
            accessibilityLabel="Ask Chesty"
            style={({ pressed }) => [styles.askWrap, pressed && styles.pressed]}
          >
            <View style={[styles.ask, { borderColor: theme.danger, backgroundColor: theme.card }]}>
              <View style={styles.askFace}>
                <Image source={require("@/assets/images/chesty.png")} style={styles.askImage} resizeMode="contain" />
              </View>
              <ThemedText
                type="smallBold"
                themeColor="danger"
                numberOfLines={1}
                style={[styles.askText, android && styles.askTextAndroid]}
              >
                {"Ask\u00a0Chesty"}
              </ThemedText>
            </View>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

// fetch rejects with a TypeError when the request never reached the server.
// Anything else means the backend answered with an error, so show its message.
function searchErrorMessage(problem: unknown): string {
  if (problem instanceof TypeError) return "Couldn't reach the product server. Check your connection and try again.";
  if (problem instanceof Error) return problem.message;
  return "Couldn't search products.";
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  column: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
  },
  top: {
    backgroundColor: Brand.navy,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
  stripe: {
    height: 4,
    backgroundColor: Brand.red,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  // Same size and shape as Home's search bar
  bar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: Spacing.three,
    paddingRight: Spacing.two,
    minHeight: SEARCH_BAR_HEIGHT,
    borderRadius: SEARCH_BAR_HEIGHT / 2,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.three,
  },
  icon: {
    width: 36,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  results: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  loading: {
    marginTop: Spacing.five,
  },
  message: {
    gap: Spacing.one,
  },
  body: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.five,
  },
  section: {
    gap: Spacing.three,
  },
  sectionTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "800",
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  recentMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  recentText: {
    flex: 1,
    fontSize: 17,
  },
  more: {
    alignSelf: "center",
  },
  askBar: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 1,
  },
  askWrap: {
    alignSelf: "center",
  },
  ask: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingLeft: Spacing.one,
    paddingRight: Spacing.four,
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
    borderWidth: 2,
  },
  askFace: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.navy,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  askImage: {
    width: 36,
    height: 36,
    marginTop: 6,
  },
  askText: {
    fontSize: 17,
    flexShrink: 0,
  },
  askTextAndroid: {
    minWidth: 96,
  },
  pressed: {
    opacity: 0.6,
  },
});
