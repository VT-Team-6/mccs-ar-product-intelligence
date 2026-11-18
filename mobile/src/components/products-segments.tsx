import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/ui/screen-header';
import { Brand, Radius, Spacing } from '@/constants/theme';

const SEGMENTS = [
  { name: 'index', label: 'Likes', href: '/products' },
  { name: 'history', label: 'History', href: '/products/history' },
] as const;

// The two halves of the Products tab. Both are real routes, so a segment can be
// linked to directly and Back still returns to the product that was opened.
// The switch sits inside the navy header band, like the Home header.
export function ProductsSegments() {
  const router = useRouter();
  // The address of the screen that is showing, e.g. /products or /products/history
  const pathname = usePathname();
  const active = pathname.startsWith('/products/history') ? 'history' : 'index';

  return (
    <ScreenHeader title="Products" eyebrow="MCCS · Your products" back={false}>
      <View style={styles.group}>
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
              style={[styles.pill, selected && styles.pillSelected]}>
              <Text style={[styles.label, selected && styles.labelSelected]}>{segment.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScreenHeader>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    gap: Spacing.half,
    marginTop: Spacing.one,
    padding: Spacing.half + 1,
    borderRadius: Radius.small + 2,
    backgroundColor: Brand.navyLight,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.small,
  },
  pillSelected: {
    backgroundColor: '#ffffff',
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.75)',
  },
  labelSelected: {
    color: Brand.navy,
  },
});