import { Stack } from 'expo-router';
import { View } from 'react-native';

import { ProductsSegments } from '@/components/products-segments';

// Likes, History and Shopping List share one tab: the segment control picks
// which one shows. There is deliberately no initialRouteName, so the stack
// always holds exactly one segment and switching between them stays at depth one.
// Switching segments has no animation, so it feels like the bottom tabs.
const NO_SLIDE = { animation: 'none' } as const;
export default function ProductsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <ProductsSegments />
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" options={NO_SLIDE} />
          <Stack.Screen name="history" options={NO_SLIDE} />
          <Stack.Screen name="shopping-list" options={NO_SLIDE} />
        </Stack>
      </View>
    </View>
  );
}
