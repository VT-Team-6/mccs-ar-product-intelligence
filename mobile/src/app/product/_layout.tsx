import { Stack } from 'expo-router';

// Holds the shopper product page, with no header bar
export default function ProductLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}