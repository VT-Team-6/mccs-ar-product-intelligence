import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

// Saves CSV text as a file. On the web it downloads; on a phone it opens the
// share sheet so the file can go to Files, email, Drive and so on.
export async function saveCsv(fileName: string, text: string): Promise<void> {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Sharing isn't available on this device.");
  }
  await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: fileName });
}

// Lets the user pick a CSV and returns its text, or null if they cancel
export async function pickCsv(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Some phones label CSVs as plain text or a spreadsheet, so allow those too
    type: ["text/csv", "text/comma-separated-values", "text/plain", "application/vnd.ms-excel"],
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (asset.file) return asset.file.text(); // web
  return new File(asset.uri).text();
}
