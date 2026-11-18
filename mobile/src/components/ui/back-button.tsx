import { useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';

// The app's one Back button, so going back works the same on every screen:
// 1. go back if there is a previous page in this session
// 2. otherwise go to "from" (the page that opened this one, e.g. /search?q=nike)
// 3. otherwise go to the fallback (Home by default)
// Step 2 and 3 matter on web, where a refreshed or shared link has no history.
export function BackButton({
  from,
  fallback = '/',
  label = 'Back',
  onDark = false,
}: {
  from?: string;
  fallback?: string;
  label?: string;
  // True when the button sits on the navy header band
  onDark?: boolean;
}) {
  const router = useRouter();

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else if (from && from.startsWith('/')) {
      router.replace(from as Href);
    } else {
      router.replace(fallback as Href);
    }
  };

  return (
    <Pressable
      onPress={goBack}
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
});