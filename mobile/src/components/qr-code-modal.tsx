import { Image } from 'expo-image';
import * as Print from 'expo-print';
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet } from 'react-native';

import { productQrUrl, type Product } from '@/api/products';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

type Props = {
  product: Product;
  visible: boolean;
  onClose: () => void;
};

// A popup that shows a product's QR code and lets the admin print it
export function QrCodeModal({ product, visible, onClose }: Props) {
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrUrl = productQrUrl(product.product_id);

  async function printLabel() {
    setPrinting(true);
    setError(null);
    try {
      const html = labelHtml(product, await imageAsDataUrl(qrUrl));
      if (Platform.OS === 'web') {
        printInBrowser(html);
      } else {
        await Print.printAsync({ html });
      }
    } catch {
      setError('Could not print the QR code.');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* The empty onPress stops taps on the card from closing the popup */}
        <Pressable onPress={() => {}}>
          <ThemedView style={styles.card}>
            <ThemedText type="smallBold" style={styles.centered}>
              {product.name}
            </ThemedText>
            <Image source={{ uri: qrUrl }} style={styles.qr} contentFit="contain" />
            <ThemedText type="small" themeColor="textSecondary">
              Product ID {product.product_id}
            </ThemedText>

            {error && <ThemedText type="small">{error}</ThemedText>}

            <Pressable
              onPress={printLabel}
              disabled={printing}
              style={({ pressed }) => [styles.button, (pressed || printing) && styles.pressed]}>
              <ThemedView type="backgroundSelected" style={styles.buttonView}>
                <ThemedText type="smallBold">{printing ? 'Preparing…' : 'Print'}</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <ThemedView type="backgroundElement" style={styles.buttonView}>
                <ThemedText type="small">Close</ThemedText>
              </ThemedView>
            </Pressable>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Downloads an image and turns it into text that can be placed directly inside the label.
// That way the printer doesn't need to reach the backend itself.
async function imageAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load the QR code');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the QR code'));
    reader.readAsDataURL(blob);
  });
}

// Product names can contain characters like " and <, which need to be made safe for HTML
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The printed label: the QR code with the product name and ID under it
function labelHtml(product: Product, qrDataUrl: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; text-align: center; margin: 24px; }
      img { width: 60mm; height: 60mm; }
      .name { font-size: 14pt; font-weight: 600; margin-top: 8px; }
      .id { font-size: 10pt; color: #555; margin-top: 4px; }
    </style>
  </head>
  <body>
    <img src="${qrDataUrl}" />
    <div class="name">${escapeHtml(product.name)}</div>
    <div class="id">Product ID ${product.product_id}</div>
  </body>
</html>`;
}

// In a browser, the label is loaded into a hidden frame and that frame is printed
function printInBrowser(html: string) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);

  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error('Could not open the print view');
  frameWindow.document.open();
  frameWindow.document.write(html);
  frameWindow.document.close();
  frameWindow.onafterprint = () => frame.remove();

  // Give the browser a moment to draw the QR code before printing
  setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
  }, 250);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Spacing.four,
    width: 300,
    maxWidth: '100%',
  },
  centered: {
    textAlign: 'center',
  },
  qr: {
    width: 220,
    height: 220,
    backgroundColor: '#ffffff',
    borderRadius: Spacing.two,
  },
  button: {
    alignSelf: 'stretch',
  },
  buttonView: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});