import { Alert, Platform } from 'react-native';

// Asks the admin "are you sure?" before something that can't be undone.
// Gives back true if they confirmed and false if they cancelled.
export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
): Promise<boolean> {
  // Browsers have their own built-in confirmation box
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }

  // On a phone, show the system alert with Cancel and a red confirm button
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}