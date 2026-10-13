import { Redirect, Stack } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';

// Makes the product list the bottom screen of the Admin tab,
// so going back from a product page always lands on the list.
export const unstable_settings = {
  initialRouteName: 'index',
};

// Lets the Admin tab hold more than one screen: the product list,
// and the product page that opens on top of it.
export default function AdminLayout() {
  const { isAdmin } = useAuth();
  // Regular users who reach /admin (for example through a link) go back to Scan
  if (!isAdmin) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}