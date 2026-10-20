import { Stack } from 'expo-router';
import { View } from 'react-native';

import { ProductsSegments } from '@/components/products-segments';

// Likes and History share one tab: the segment control picks which one shows.
// There is deliberately no initialRouteName, so the stack always holds exactly
// one segment and switching between them stays at depth one.
export default function ProductsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <ProductsSegments />
      <View style={{ flex: 1 }}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </View>
  );
}
