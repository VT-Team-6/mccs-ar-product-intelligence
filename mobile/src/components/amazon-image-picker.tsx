import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, TextInput, View,
} from 'react-native';

import { searchListingImages, type ReviewCandidate } from '@/api/reviews';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { imageUrlProblem } from '@/utils/product-images';

type Props = {
  visible: boolean;
  /** The product's name, used as the first search and as the dialog's context. */
  productName: string;
  onClose: () => void;
  /**
   * Called with the listing's image link once the admin picks one. The image is
   * already known to have loaded, so the caller can save it straight away.
   */
  onChoose: (imageUrl: string, listingId: string) => void;
};

// Search Amazon listings and return one of their photos.
//
// Shared by the product form. Originally in product-image-picker.tsx, but moved here 
// to be used by the product-images admin page as well.
export function AmazonImagePicker({ visible, productName, onClose, onChoose }: Props) {
  const theme = useTheme();
  const [query, setQuery] = useState(productName);
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A search that finishes after the dialog was closed or replaced must not
  // overwrite the results of the newer one.
  const requestId = useRef(0);

  useEffect(() => {
    if (!visible) {
      requestId.current += 1;
      return;
    }
    setQuery(productName);
    setCandidates([]);
    setSearched(false);
    setError(null);
    if (productName.trim()) void search(productName);
  }, [visible]);

  useEffect(() => () => { requestId.current += 1; }, []);

  async function search(text: string) {
    const searchText = text.trim();
    if (!searchText) return;
    const id = ++requestId.current;
    setSearching(true);
    setError(null);
    try {
      const found = await searchListingImages(searchText);
      if (id !== requestId.current) return;
      setCandidates(found);
      setSearched(true);
    } catch (failure) {
      if (id === requestId.current) {
        setError(failure instanceof Error ? failure.message : 'Could not load listing images.');
      }
    } finally {
      if (id === requestId.current) setSearching(false);
    }
  }

  function close() {
    requestId.current += 1;
    setSearching(false);
    onClose();
  }

  function choose(candidate: ReviewCandidate) {
    const url = candidate.image_url?.trim();
    if (!url || imageUrlProblem(url)) return;
    onChoose(url, candidate.source_product_id);
    close();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ThemedView style={styles.dialog}>
          <View style={styles.header}>
            <ThemedText type="subtitle" style={styles.heading}>Choose Amazon image</ThemedText>
            <Button label="Close" onPress={close} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Check the model, flavor, and package size before choosing a photo.
          </ThemedText>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by product name or Amazon listing ID"
            placeholderTextColor={theme.textSecondary}
            accessibilityLabel="Search Amazon images"
            maxLength={200}
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => { if (!searching) void search(query); }}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <Button label={searching ? 'Searching…' : 'Search listings'} onPress={() => void search(query)} disabled={searching || !query.trim()} />
          {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
          {searching && <ActivityIndicator accessibilityLabel="Loading listing images" />}
          <ScrollView style={styles.results} contentContainerStyle={styles.section} keyboardShouldPersistTaps="handled">
            {candidates.map((candidate) => (
              <ListingImage key={`${candidate.source_product_id}:${candidate.image_url}`} candidate={candidate} onChoose={() => choose(candidate)} />
            ))}
            {!searching && searched && candidates.length === 0 && (
              <ThemedText themeColor="textSecondary">No matching listings. Try another name or listing ID, or use a custom image link.</ThemedText>
            )}
          </ScrollView>
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ListingImage({ candidate, onChoose }: { candidate: ReviewCandidate; onChoose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const url = candidate.image_url?.trim();
  const valid = !!url && !imageUrlProblem(url);
  return (
    <ThemedView type="backgroundElement" style={styles.listing}>
      <ThemedText type="smallBold">{candidate.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">Amazon listing: {candidate.source_product_id}</ThemedText>
      {valid ? (
        <ImagePreview uri={url!} onLoaded={() => setLoaded(true)} onUnavailable={() => setLoaded(false)} />
      ) : (
        <ThemedText type="small" themeColor="textSecondary">This listing has no usable image link.</ThemedText>
      )}
      <Button label="Use this image" onPress={onChoose} disabled={!valid || !loaded} />
    </ThemedView>
  );
}

export function ImagePreview({ uri, onLoaded, onUnavailable }: { uri: string; onLoaded?: () => void; onUnavailable?: () => void }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const statusRef = useRef(status);
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;
  statusRef.current = status;
  useEffect(() => {
    const timer = setTimeout(() => {
      if (statusRef.current === 'loading') {
        setStatus('error');
        unavailableRef.current?.();
      }
    }, 20000);
    return () => clearTimeout(timer);
  }, [attempt, uri]);
  return (
    <View style={styles.previewSection}>
      <View style={styles.imageFrame}>
        <Image
          key={`${uri}:${attempt}`}
          source={{ uri }}
          style={styles.image}
          contentFit="contain"
          accessibilityLabel="Product image preview"
          onLoad={() => { setStatus('loaded'); onLoaded?.(); }}
          onError={() => { setStatus('error'); onUnavailable?.(); }}
        />
        {status === 'loading' && <ActivityIndicator style={StyleSheet.absoluteFill} accessibilityLabel="Loading image preview" />}
      </View>
      {status === 'error' && (
        <>
          <ThemedText type="small" style={styles.error}>Could not load this image. Try another direct image link or retry.</ThemedText>
          <Button label="Retry image" onPress={() => { setStatus('loading'); setAttempt((current) => current + 1); }} />
        </>
      )}
    </View>
  );
}

function Button({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dimmed]}>
      <ThemedText type="linkPrimary">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  input: { fontSize: 16, paddingVertical: Spacing.two + Spacing.half, paddingHorizontal: Spacing.three, borderRadius: Spacing.three },
  button: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.one },
  dimmed: { opacity: .4 },
  previewSection: { gap: Spacing.one },
  imageFrame: { height: 160, width: '100%', backgroundColor: '#ffffff', borderRadius: Spacing.two, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.6)', alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  dialog: { width: '100%', maxWidth: 620, maxHeight: '90%', padding: Spacing.three, borderRadius: Spacing.three, gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heading: { flex: 1, fontSize: 22, lineHeight: 28 },
  results: { flexShrink: 1 },
  listing: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  error: { color: '#E5484D' },
});
