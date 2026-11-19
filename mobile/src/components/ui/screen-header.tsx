import type { ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/ui/back-button';
import { Brand, MaxContentWidth, Spacing } from '@/constants/theme';

// The navy band at the top of every screen, the same look as the Home header:
// a round Back button left of the title, a small label above the title, the
// title in white, then a red stripe.
// It spans the full width, so put it outside the screen's padded content.
export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  back = true,
  from,
  fallback,
  backLabel,
  children,
}: {
  title: string;
  // Small caps label above the title, e.g. "SIDE BY SIDE"
  eyebrow?: string;
  subtitle?: string;
  // Tab screens (Home, Products, Account) have no Back
  back?: boolean;
  from?: string;
  fallback?: string;
  backLabel?: string;
  // Anything that belongs in the band under the title, such as the Likes / History switch
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View>
      <View
        style={[
          styles.band,
          // On web the tab bar floats at the top, so start below it
          { paddingTop: Platform.OS === 'web' ? Spacing.six : insets.top + Spacing.three },
        ]}>
        <View style={styles.inner}>
          <View style={styles.titleRow}>
            {back && <BackButton from={from} fallback={fallback} label={backLabel} iconOnly />}
            <View style={styles.titleBlock}>
              {eyebrow && <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>}
              <Text style={styles.title} numberOfLines={2}>
                {title}
              </Text>
              {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
          </View>
          {children}
        </View>
      </View>
      <View style={styles.stripe} />
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: Brand.navy,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  // Lines the band's text up with the page content on a wide browser window
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    gap: Spacing.two,
  },
  // Back sits left of the title, centered on it
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  titleBlock: {
    flex: 1,
    gap: Spacing.half,
  },
  eyebrow: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    lineHeight: 20,
  },
  stripe: {
    height: 4,
    backgroundColor: Brand.red,
  },
});