import { type RefObject, useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  type TextInput,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

// Room the bar itself takes above the keyboard
const BAR_SPACE = 64;

// Same blue as the system cursor
const CURSOR_COLOR = "#3c87f7";

// A blinking cursor. Changing `restartKey` (the typed value) keeps it solid
// while typing, like the real one.
function BlinkingCursor({ restartKey }: { restartKey: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    opacity.setValue(1);
    const blink = Animated.loop(
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(opacity, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(500),
        Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [opacity, restartKey]);

  return <Animated.View style={[styles.cursor, { opacity }]} />;
}

type Props = {
  // The field being typed in, or null when none of the screen's number fields has focus
  label: string | null;
  value: string;
  // That field, so the bar only shows when the keyboard covers it
  field: RefObject<TextInput | null> | null;
  // Told when the bar appears or goes away, so the field can hide its own
  // cursor while the bar shows one
  onShowingChange?: (showing: boolean) => void;
};

// iOS number keyboards have no Done key and can cover the field being typed in.
// This bar floats on top of the keyboard whenever it's open for one of the
// screen's number fields and the keyboard would hide that field, showing what's
// being typed plus Done. When the field is visible the bar stays out of the way.
//
// Render it once, as the last child of the screen's full-screen view, and set
// `label` and `field` from each field's onFocus / onBlur. Use onShowingChange to
// set those fields' caretHidden, so while the bar shows, the blinking cursor is
// here instead of in the hidden field. It's drawn by the app instead of
// using InputAccessoryView, which sometimes doesn't appear when moving straight
// from one field to another.
export function KeyboardDoneBar({ label, value, field, onShowingChange }: Props) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [covered, setCovered] = useState(false);

  // Checks whether the keyboard (plus the bar) would hide the field. Checked
  // again every so often while typing, in case the screen moved.
  useEffect(() => {
    if (Platform.OS !== "ios" || keyboardHeight === 0 || !field) {
      setCovered(false);
      return;
    }
    const check = () =>
      field.current?.measureInWindow((_x, y, _width, height) => {
        const keyboardTop = Dimensions.get("window").height - keyboardHeight;
        setCovered(y + height > keyboardTop - BAR_SPACE);
      });
    check();
    const timer = setInterval(check, 300);
    return () => clearInterval(timer);
  }, [field, keyboardHeight]);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const shown = Keyboard.addListener("keyboardWillShow", (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hidden = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const showing = Platform.OS === "ios" && keyboardHeight > 0 && label !== null && covered;
  useEffect(() => {
    onShowingChange?.(showing);
  }, [showing, onShowingChange]);

  if (!showing) return null;

  return (
    <ThemedView type="backgroundElement" style={[styles.bar, { bottom: keyboardHeight + Spacing.two }]}>
      <View style={styles.preview}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {`${label}: `}
        </ThemedText>
        {value !== "" && <ThemedText type="smallBold">{value}</ThemedText>}
        <BlinkingCursor restartKey={value} />
      </View>
      <Pressable onPress={Keyboard.dismiss} hitSlop={12}>
        <ThemedText type="linkPrimary">Done</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // A rounded bar floating just above the keyboard
  bar: {
    position: "absolute",
    left: Spacing.two,
    right: Spacing.two,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.four,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  preview: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  cursor: {
    width: 2,
    height: 18,
    marginLeft: 1,
    borderRadius: 1,
    backgroundColor: CURSOR_COLOR,
  },
});
