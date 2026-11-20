import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Product } from '@/api/products';
import { getRecommendations, type RecommendationResult } from '@/api/recommendations';
import { useAuth } from '@/auth/AuthContext';
import { MatchCard } from '@/components/match-card';
import { RankPicker } from '@/components/rank-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Brand, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CRITERIA, rankedCount, type Preferences } from '@/preferences/criteria';
import { describeUnderstood, EXAMPLE_REQUESTS, MAX_REQUEST_LENGTH, rankingFromParam } from '@/search/advanced';
import { useStore } from '@/store/StoreContext';

// The character count only shows once the message gets close to the limit
const SHOW_COUNT_AT = 150;

// One question to Chesty and his answer, which fills in once the search returns
type Exchange = {
  id: number;
  text: string;
  ranking: Preferences;
  status: 'loading' | 'done' | 'error';
  result: RecommendationResult | null;
};

// Ask Chesty: advanced search laid out as a chat with Chesty. Chesty asks what
// the shopper is looking for, they answer in their own words in the box at the
// bottom, and can optionally open "What matters most?" to rank what counts.
// It isn't a live AI chat: sending runs the same advanced search as before,
// and Chesty answers in the chat with the best matches.
export default function AdvancedSearchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { store } = useStore();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Coming back from the results with "Edit search" keeps what was typed and ranked
  const params = useLocalSearchParams<{ q?: string; rank?: string }>();
  const [text, setText] = useState(params.q ?? '');
  const [ranking, setRanking] = useState(() => rankingFromParam(params.rank));
  const [prioritiesOpen, setPrioritiesOpen] = useState(false);
  // Everything asked so far, each with Chesty's answer
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const scroll = useRef<ScrollView>(null);
  // The chat area's height, so the newest question can be scrolled to the top
  const [chatHeight, setChatHeight] = useState(0);
  // The question just sent, scrolled to the top once it's laid out
  const scrollToId = useRef<number | null>(null);
  const asked = useRef(0);

  const request = text.trim();
  const ready = request.length > 0;
  const ranked = rankedCount(ranking);

  // "Price, Rating" in the order they were ranked, for the closed dropdown
  const rankedNames = CRITERIA.filter(({ key }) => ranking[key] > 0)
    .sort((a, b) => ranking[a.key] - ranking[b.key])
    .map(({ label }) => label)
    .join(', ');

  // The box sits on the keyboard while it's up, else above the home indicator
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const shown = Keyboard.addListener(showEvent, () => {
      setKeyboardUp(true);
      // Before the first question, keep Chesty's prompts in view above the box
      if (asked.current === 0) setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 250);
    });
    const hidden = Keyboard.addListener(hideEvent, () => setKeyboardUp(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const togglePriorities = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPrioritiesOpen((was) => !was);
  };

  const update = (id: number, change: Partial<Exchange>) =>
    setExchanges((all) => all.map((one) => (one.id === id ? { ...one, ...change } : one)));

  // Runs the advanced search for one question and fills in Chesty's answer
  const ask = (id: number, question: string, priorities: Preferences) => {
    update(id, { status: 'loading', result: null });
    getRecommendations(
      { text: question, ranking: priorities },
      { signedIn: !!user, storeId: store?.store_id },
    )
      .then((result) => update(id, { status: 'done', result }))
      .catch(() => update(id, { status: 'error' }));
  };

  // Shows the message in the chat and Chesty starts looking
  const send = () => {
    if (!ready) return;
    Keyboard.dismiss();
    const id = Date.now();
    const priorities = { ...ranking };
    setExchanges((all) => [...all, { id, text: request, ranking: priorities, status: 'loading', result: null }]);
    asked.current += 1;
    scrollToId.current = id;
    setText('');
    setPrioritiesOpen(false);
    ask(id, request, priorities);
  };

  // Puts the question just sent at the top, with Chesty's answer filling in under it
  const placeExchange = (id: number, y: number) => {
    if (scrollToId.current !== id) return;
    scrollToId.current = null;
    scroll.current?.scrollTo({ y: Math.max(0, y - Spacing.three), animated: true });
  };

  // The dropdown sits wherever Chesty is asking: under his first question, then
  // under his latest answer
  const priorityPicker = (
    <ThemedView type="card" style={[styles.priorities, { borderColor: theme.border }]}>
      <Pressable
        onPress={togglePriorities}
        accessibilityRole="button"
        accessibilityState={{ expanded: prioritiesOpen }}
        accessibilityLabel="What matters most? Optional"
        style={({ pressed }) => [styles.prioritiesTop, pressed && styles.pressed]}>
        <View style={styles.prioritiesText}>
          <ThemedText type="smallBold">What matters most?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {ranked > 0 ? rankedNames : 'Optional. Tap to choose'}
          </ThemedText>
        </View>
        <SymbolView
          name={{
            ios: prioritiesOpen ? 'chevron.up' : 'chevron.down',
            android: prioritiesOpen ? 'expand_less' : 'expand_more',
            web: prioritiesOpen ? 'expand_less' : 'expand_more',
          }}
          size={16}
          tintColor={theme.textSecondary}
        />
      </Pressable>
      {prioritiesOpen && (
        <View style={styles.prioritiesBody}>
          <ThemedText type="small" themeColor="textSecondary">
            Tap in order. Anything you don’t pick counts equally.
          </ThemedText>
          <RankPicker value={ranking} onChange={setRanking} compact />
        </View>
      )}
    </ThemedView>
  );

  // Back from the product returns to this chat, answers and all
  const openProduct = (product: Product) => {
    router.push(`/product/${product.product_id}?from=${encodeURIComponent('/advanced-search')}&via=recommendation` as Href);
  };

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title="Ask Chesty" eyebrow="Advanced search" fallback="/" compact />

      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroll}
          // Full width, so the scroll bar sits at the screen's edge
          style={styles.container}
          onLayout={(event) => setChatHeight(event.nativeEvent.layout.height)}
          contentContainerStyle={[styles.chat, styles.column]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive">
          <ChestySays>
            {"Hey, I'm Chesty! What are you looking for? Tell me in your own words, like what it's for and your budget."}
          </ChestySays>

          {/* Quick replies: tapping one puts it in the box */}
          <View style={styles.suggestions}>
            {EXAMPLE_REQUESTS.map((example) => (
              <Pressable
                key={example}
                onPress={() => setText(example)}
                accessibilityRole="button"
                accessibilityLabel={`Use: ${example}`}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="card" style={[styles.suggestion, { borderColor: theme.link }]}>
                  <ThemedText type="small" themeColor="link">
                    {example}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            ))}
          </View>

          <ChestySays>Anything matter most to you? This part is optional.</ChestySays>

          {exchanges.length === 0 && priorityPicker}

          {exchanges.map((exchange, index) => {
            const latest = index === exchanges.length - 1;
            return (
              <View
                key={exchange.id}
                onLayout={(event) => placeExchange(exchange.id, event.nativeEvent.layout.y)}
                // The latest question gets at least a screen of room, so it can
                // sit at the top even before Chesty's answer fills in
                style={[styles.exchange, latest && { minHeight: Math.max(0, chatHeight - Spacing.four * 2) }]}>
                <View style={styles.youRow}>
                  <View style={styles.youBubble}>
                    <ThemedText style={styles.youText}>{exchange.text}</ThemedText>
                  </View>
                </View>
                <ChestyAnswer
                  exchange={exchange}
                  onRetry={() => ask(exchange.id, exchange.text, exchange.ranking)}
                  onOpen={openProduct}
                />
                {/* Once Chesty has answered, he asks what's next */}
                {latest && exchange.status !== 'loading' && (
                  <>
                    <ChestySays>Looking for something else? Tell me below.</ChestySays>
                    {priorityPicker}
                  </>
                )}
              </View>
            );
          })}
        </ScrollView>

        {/* The message box, pinned at the bottom like a chat app */}
        <View
          style={[
            styles.composerWrap,
            { borderTopColor: theme.border, paddingBottom: keyboardUp ? Spacing.two : insets.bottom + Spacing.two },
          ]}>
          <View style={[styles.composer, styles.column]}>
            <View style={[styles.box, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Message Chesty"
                placeholderTextColor={theme.textSecondary}
                multiline
                maxLength={MAX_REQUEST_LENGTH}
                accessibilityLabel="What are you looking for?"
                style={[styles.input, { color: theme.text }]}
              />
              {text.length >= SHOW_COUNT_AT && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.counter}>
                  {`${text.length}/${MAX_REQUEST_LENGTH}`}
                </ThemedText>
              )}
            </View>
            <Pressable
              onPress={send}
              disabled={!ready}
              accessibilityRole="button"
              accessibilityLabel="Send to Chesty"
              style={({ pressed }) => [
                styles.send,
                { backgroundColor: ready ? Brand.red : theme.backgroundElement },
                pressed && styles.pressed,
              ]}>
              <SymbolView
                name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
                size={18}
                weight="bold"
                tintColor={ready ? '#ffffff' : theme.textSecondary}
              />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

// Chesty's reply to one question: looking, the matches, nothing found, or a
// problem with a retry
function ChestyAnswer({
  exchange,
  onRetry,
  onOpen,
}: {
  exchange: Exchange;
  onRetry: () => void;
  onOpen: (product: Product) => void;
}) {
  const theme = useTheme();
  const { status, result } = exchange;

  if (status === 'loading') {
    return (
      <ChestySays>
        <View style={styles.thinking}>
          <ActivityIndicator size="small" />
          <ThemedText style={styles.chestyText}>On it! Finding the best matches…</ThemedText>
        </View>
      </ChestySays>
    );
  }

  if (status === 'error' || !result) {
    return (
      <ChestySays>
        <View style={styles.bubbleStack}>
          <ThemedText style={styles.chestyText}>
            {"Sorry, I couldn't reach the product server. Check your connection and try again."}
          </ThemedText>
          <Pressable onPress={onRetry} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText type="linkPrimary">Try again</ThemedText>
          </Pressable>
        </View>
      </ChestySays>
    );
  }

  // How the search was read, e.g. ["Under $175", "Waterproof"]
  const understood = describeUnderstood(result.understood);
  const priorities = CRITERIA.filter(({ key }) => exchange.ranking[key] > 0)
    .sort((a, b) => exchange.ranking[a.key] - exchange.ranking[b.key])
    .map(({ label }) => label);

  if (result.best_matches.length === 0) {
    return (
      <ChestySays>
        {understood.length > 0
          ? "I couldn't find anything that matches all of that. Try a higher budget or fewer must-haves."
          : 'I couldn\'t find a good match. Try describing it differently, like "boots for snow".'}
      </ChestySays>
    );
  }

  const count = result.best_matches.length;
  return (
    <View style={styles.answer}>
      <ChestySays>
        <View style={styles.bubbleStack}>
          <ThemedText style={styles.chestyText}>
            {count === 1 ? "Here's my best match:" : `Here are my top ${count} matches:`}
          </ThemedText>
          {understood.length > 0 && (
            <View style={styles.understood}>
              {understood.map((label) => (
                <View key={label} style={[styles.understoodChip, { borderColor: theme.link }]}>
                  <ThemedText type="small" themeColor="link">
                    {label}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
          {priorities.length > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {`Your priorities: ${priorities.map((label, i) => `${i + 1}. ${label}`).join('  ')}`}
            </ThemedText>
          )}
        </View>
      </ChestySays>

      {result.best_matches.map((item, index) => (
        <MatchCard key={item.product.product_id} item={item} rank={index + 1} onOpen={onOpen} />
      ))}

      {result.for_you && (
        <>
          <ChestySays>Based on your likes and preferences, you might also like this one:</ChestySays>
          <MatchCard item={result.for_you} onOpen={onOpen} highlight />
        </>
      )}
    </View>
  );
}

// One of Chesty's chat bubbles, with his face on the left
function ChestySays({ children }: { children: ReactNode }) {
  return (
    <View style={styles.chestyRow}>
      <View style={styles.face}>
        <Image source={require('@/assets/images/chesty.png')} style={styles.faceImage} resizeMode="contain" />
      </View>
      <ThemedView type="backgroundElement" style={styles.chestyBubble}>
        {typeof children === 'string' ? <ThemedText style={styles.chestyText}>{children}</ThemedText> : children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  column: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  chat: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  chestyRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingRight: Spacing.six,
  },
  face: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Brand.navy,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  faceImage: {
    width: 32,
    height: 32,
    marginTop: 6,
  },
  chestyBubble: {
    flexShrink: 1,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
  },
  chestyText: {
    fontSize: 16,
    lineHeight: 22,
  },
  // Lined up under Chesty's bubble, past his face
  suggestions: {
    gap: Spacing.two,
    alignItems: 'flex-start',
    paddingLeft: 36 + Spacing.two,
    marginTop: -Spacing.one,
  },
  suggestion: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  priorities: {
    marginLeft: 36 + Spacing.two,
    marginTop: -Spacing.one,
    borderWidth: 1,
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
  },
  prioritiesTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two + Spacing.half,
  },
  prioritiesText: {
    flex: 1,
    gap: Spacing.half,
  },
  prioritiesBody: {
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  exchange: {
    gap: Spacing.three,
  },
  answer: {
    gap: Spacing.two,
  },
  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  bubbleStack: {
    gap: Spacing.two,
  },
  understood: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  understoodChip: {
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  youRow: {
    alignItems: 'flex-end',
    paddingLeft: Spacing.six,
  },
  // The shopper's messages: navy, on the right
  youBubble: {
    backgroundColor: Brand.navy,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: 18,
    borderBottomRightRadius: 4,
  },
  youText: {
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 22,
  },
  composerWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  box: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
  },
  input: {
    fontSize: 16,
    maxHeight: 120,
    paddingTop: Spacing.two + Spacing.half,
    paddingBottom: Spacing.two + Spacing.half,
  },
  counter: {
    alignSelf: 'flex-end',
    paddingBottom: Spacing.one,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
