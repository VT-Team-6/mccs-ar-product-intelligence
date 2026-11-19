import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

// Search results now show on the search screen itself (/find). This keeps old
// /search links working: /search?q=nike opens /find?q=nike.
export default function SearchRedirect() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const query = (q ?? '').trim();
  return <Redirect href={(query ? `/find?q=${encodeURIComponent(query)}` : '/find') as Href} />;
}
