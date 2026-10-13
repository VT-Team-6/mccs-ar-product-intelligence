import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createProduct } from '@/api/products';
import { ProductForm } from '@/components/product-form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

export default function AddProductScreen() {
  const router = useRouter();

  // Goes back to the list. If there's nothing to go back to, opens the list directly.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/admin'));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={goBack} hitSlop={12} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="linkPrimary">‹ Cancel</ThemedText>
        </Pressable>
        <ThemedText type="subtitle" style={styles.title}>
          Add product
        </ThemedText>

        <ProductForm
          submitLabel="Add product"
          onSubmit={async (values) => {
            await createProduct(values);
            goBack();
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
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
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
  },
  pressed: {
    opacity: 0.4,
  },
});