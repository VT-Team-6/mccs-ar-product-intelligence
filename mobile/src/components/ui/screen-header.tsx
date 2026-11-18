import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BackButton } from '@/components/ui/back-button';
import { Brand, Spacing } from '@/constants/theme';

// The top of every inner screen: Back, the title, an optional line under it,
// and a short red accent bar that ties the screen to the MCCS look.
export function ScreenHeader({
  title,
  subtitle,
  back = true,
  from,
  fallback,
  backLabel,
}: {
  title: string;
  subtitle?: string;
  // Tab screens (Home, Products, Account) have no Back
  back?: boolean;
  from?: string;
  fallback?: string;
  backLabel?: string;
}) {
  return (
    <View style={styles.header}>
      {back && <BackButton from={from} fallback={fallback} label={backLabel} />}
      <View style={styles.titleBlock}>
        <View style={styles.accent} />
        <ThemedText type="subtitle" style={styles.title}>
          {title}
        </ThemedText>
        {subtitle && <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.two,
  },
  titleBlock: {
    gap: Spacing.one,
  },
  accent: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Brand.red,
    marginBottom: Spacing.one,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 800,
  },
});