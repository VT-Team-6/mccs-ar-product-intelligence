import { usePathname, useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

const SEGMENTS = [
  { name: 'index', label: 'Likes', href: '/products' },
  { name: 'history', label: 'History', href: '/products/history' },
] as const;

// The two halves of the Products tab. Both are real routes, so a segment can be
// linked to directly and Back still returns to the product that was opened.
export function ProductsSegments() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The address of the screen that is showing, e.g. /products or /products/history
  const pathname = usePathname();
  const active = pathname.startsWith('/products/history') ? 'history' : 'index';

  return (
    <ThemedView
      style={[
        styles.bar,
        // On web the tab bar sits at the top, so clear it as well
        { paddingTop: Platform.OS === 'web' ? Spacing.six + Spacing.four : insets.top + Spacing.two },
      ]}>
      <ThemedView type="backgroundElement" style={styles.group}>
        {SEGMENTS.map((segment) => {
          const selected = active === segment.name;
          return (
            <Pressable
              key={segment.name}
              onPress={() => {
                // replace, so switching segments never grows the stack
                if (!selected) router.replace(segment.href);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={styles.trigger}>
              <ThemedView
                type={selected ? 'backgroundSelected' : 'backgroundElement'}
                style={styles.pill}>
                <ThemedText type="smallBold">{segment.label}</ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  group: {
    flexDirection: 'row',
    gap: Spacing.half,
    width: '100%',
    maxWidth: MaxContentWidth,
    padding: Spacing.half,
    borderRadius: Spacing.three,
  },
  trigger: {
    flex: 1,
  },
  pill: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
});
