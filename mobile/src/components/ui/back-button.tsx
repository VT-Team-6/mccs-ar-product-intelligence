import { useNavigation, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ThemedText } from '@/components/themed-text';

// The app's one Back button, so going back works the same on every screen:
// 1. go to "from" (the page that opened this one, e.g. /search?q=nike) when the
//    page right underneath is just the tabs. That happens after a web refresh,
//    when the tabs are put back underneath and plain "back" would land on Home.
// 2. otherwise go back if there is a previous page in this session
// 3. otherwise go to the fallback (Home by default)
export function BackButton({
  from,
  fallback = '/',
  label = 'Back',
  onDark = false,
  iconOnly = false,
  onPress,
}: {
  from?: string;
  fallback?: string;
  label?: string;
  // True when the button sits on the navy header band
  onDark?: boolean;
  // Just a round chevron, no text (used in the header band, left of the title).
  // The label is still read out by screen readers.
  iconOnly?: boolean;
  // Replaces the usual going back, for screens that need their own
  onPress?: () => void;
}) {
  const router = useRouter();
  const navigation = useNavigation();

  const goBack = () => {
    // The page right underneath this one in the stack, if any
    const state = navigation.getState();
    const below = state && state.index > 0 ? state.routes[state.index - 1] : undefined;
    const onlyTabsBelow = !below || below.name === '(tabs)';

    if (from && from.startsWith('/') && onlyTabsBelow) {
      router.replace(from as Href);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(fallback as Href);
    }
  };

  if (iconOnly) {
    return (
      <Pressable
        onPress={onPress ?? goBack}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={label === 'Back' ? 'Back' : `Back to ${label}`}
        style={({ pressed }) => [styles.circle, pressed && styles.pressed]}>
        <Text style={styles.chevron}>‹</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress ?? goBack}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <ThemedText type="linkPrimary" style={onDark && styles.onDark}>
        {`‹ ${label}`}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: {
    alignSelf: 'flex-start',
  },
  pressed: {
    opacity: 0.6,
  },
  onDark: {
    color: '#C9D6EC',
  },
  // A soft white circle on the navy band, the same size as the title's line height
  circle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevron: {
    color: '#ffffff',
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '600',
    // The ‹ glyph sits a little right of center; nudge it back
    marginLeft: -2,
    marginTop: -2,
  },
});