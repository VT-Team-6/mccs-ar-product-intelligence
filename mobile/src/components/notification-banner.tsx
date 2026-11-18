import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getMessages, type Message } from "@/api/reorders";
import { useAuth } from "@/auth/AuthContext";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";

// How often to check for new notifications while the app is open
const CHECK_EVERY_MS = 20_000;
// How long a banner stays before sliding away
const SHOW_FOR_MS = 4_500;

type Banner = { title: string; text: string; message: Message | null };

// A banner that slides down from the top, like a phone notification, when staff
// get low-stock alerts, order requests or buyer updates. It shows unread ones
// right after signing in, then anything new: checked every 20 seconds and when
// the app comes back from the background. It hides on its own; tap to open.
export function NotificationBanner() {
  const { profile, hasPermission } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isStaff = hasPermission("manage_stock") || hasPermission("manage_inventory");

  const [banner, setBanner] = useState<Banner | null>(null);
  const slide = useRef(new Animated.Value(-200)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The newest notification already shown, so each one shows once
  const lastSeenId = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(slide, { toValue: -200, duration: 250, useNativeDriver: true }).start(() =>
      setBanner(null),
    );
  }, [slide]);

  const show = useCallback(
    (next: Banner) => {
      setBanner(next);
      slide.setValue(-200);
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(hide, SHOW_FOR_MS);
    },
    [hide, slide],
  );

  const check = useCallback(async () => {
    let result;
    try {
      result = await getMessages();
    } catch {
      return; // offline or signed out: try again next time
    }
    const unread = result.messages.filter((message) => !message.read);
    const newestId = result.messages[0]?.message_id ?? 0;
    const firstCheck = lastSeenId.current === null;
    const fresh = firstCheck ? unread : unread.filter((m) => m.message_id > (lastSeenId.current ?? 0));
    lastSeenId.current = Math.max(lastSeenId.current ?? 0, newestId);
    if (fresh.length === 0) return;

    if (fresh.length === 1) {
      show({ title: titleFor(fresh[0]), text: fresh[0].subject, message: fresh[0] });
    } else if (firstCheck) {
      show({ title: "Reorders", text: `You have ${fresh.length} unread updates.`, message: null });
    } else {
      show({ title: titleFor(fresh[0]), text: `${fresh[0].subject} (+${fresh.length - 1} more)`, message: fresh[0] });
    }
  }, [show]);

  // Start when staff sign in (so it shows on every sign-in), stop when they sign out
  useEffect(() => {
    if (!profile || !isStaff) {
      lastSeenId.current = null;
      return;
    }
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [profile, isStaff, check]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  if (!banner) return null;

  const open = () => {
    hide();
    const message = banner.message;
    if (message?.kind === "order_request" && message.request_id !== null) {
      router.push({ pathname: "/account/request/[id]", params: { id: String(message.request_id) } });
    } else {
      router.push("/account/reorders");
    }
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingTop: insets.top + Spacing.two, transform: [{ translateY: slide }] }]}
    >
      <Pressable onPress={open} style={styles.press}>
        <ThemedView type="backgroundElement" style={styles.banner}>
          <View style={styles.dot} />
          <View style={styles.text}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {banner.title}
            </ThemedText>
            <ThemedText type="small" numberOfLines={2}>
              {banner.text}
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    </Animated.View>
  );
}

function titleFor(message: Message): string {
  if (message.kind === "low_stock") return "Low stock";
  if (message.kind === "order_request") return "New order request";
  return "Order update";
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: Spacing.two,
  },
  press: {
    width: "100%",
    maxWidth: MaxContentWidth,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#3c87f7",
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
});
