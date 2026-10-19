import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { searchProducts, type Product } from '@/api/products';
import { ProductCard } from '@/components/product-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function SearchResultsScreen() {
  // The text after "?q=" in the address: /search?q=boot gives q = "boot"
  const { q } = useLocalSearchParams<{ q?: string }>();
  const query = (q ?? '').trim();
  const router = useRouter();
  const theme = useTheme();
  // What's typed in the search box. Starts with the current search, if any.
  const [text, setText] = useState(query);

  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Goes up by one each time "Try again" is pressed, which runs the search again
  const [attempt, setAttempt] = useState(0);

  // Runs the search whenever the search text changes or "Try again" is pressed
  useEffect(() => {
    setError(null);
    if (!query) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchProducts(query)
      .then((found) => {
        if (!cancelled) setResults(found);
      })
      .catch((problem: unknown) => {
        if (!cancelled) {
          setResults([]);
          setError(searchErrorMessage(problem));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, attempt]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
                <Pressable onPress={() => router.back()} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="linkPrimary">‹ Back</ThemedText>
        </Pressable>

        <ThemedText type="subtitle">Search results</ThemedText>

        {/* Pressing Search on the keyboard puts the text in ?q=, which runs the search */}
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => router.setParams({ q: text.trim() })}
          placeholder="Search products"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="search"
          autoFocus={query === ''}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
                {query === '' ? (
          <ThemedText themeColor="textSecondary">Type a search to see matching products.</ThemedText>
        ) : (
          <ThemedText themeColor="textSecondary">{`Showing results for "${query}"`}</ThemedText>
        )}

        {loading && <ActivityIndicator />}

        {error && (
          <ThemedView style={styles.message}>
            <ThemedText themeColor="textSecondary">{error}</ThemedText>
            <Pressable
              onPress={() => setAttempt((count) => count + 1)}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="linkPrimary">Try again</ThemedText>
            </Pressable>
          </ThemedView>
        )}

        <FlatList
          data={results}
          keyExtractor={(product) => String(product.product_id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ResultRow product={item} query={query} />}
          ListEmptyComponent={
            query !== '' && !loading && !error ? (
              <ThemedText themeColor="textSecondary">{`No products match "${query}".`}</ThemedText>
            ) : null
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

// fetch rejects with a TypeError when the request never reached the server.
// Anything else means the backend answered with an error status, so show that message.
// Increases error handling.
// Could change to be more user-friendly and move the technical details to a log file, but for now this is fine.
function searchErrorMessage(problem: unknown): string {
  if (problem instanceof TypeError) {
    return 'Could not reach the backend. Is it running?';
  }
  if (problem instanceof Error) {
    return problem.message;
  }
  return 'Could not search products.';
}

function ResultRow({ product, query }: { product: Product; query: string }) {
  const router = useRouter();

  // Opens the product details page, e.g. /product/2.
  // "from" tells that page to come back to these search results when Back is pressed.
  const openProduct = () => {
    const searchPage = `/search?q=${encodeURIComponent(query)}`;
    router.push(`/product/${product.product_id}?from=${encodeURIComponent(searchPage)}` as Href);
  };

  return <ProductCard product={product} onPress={openProduct} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    // On web the tab bar sits at the top, so leave room for it
    paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.four : Spacing.three,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  search: {
    fontSize: 16,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  message: {
    gap: Spacing.one,
  },
  list: {
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});