// For debugging the signed-in user's profile, role, and permissions.

import { getUser, User } from "@/api/general";
import { useState } from "react";
import { Button, View } from "react-native";
import { ThemedText } from "../themed-text";

export default function UserTest() {
  const [userInfo, setUserInfo] = useState<User | null>();
  const [error, setError] = useState<string>("");

  async function getUserCall() {
    try {
      const user = await getUser();
      setUserInfo(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <View>
      <ThemedText>{error}</ThemedText>
      {userInfo && <ThemedText>{JSON.stringify(userInfo, null, 2)}</ThemedText>}
      <Button
        title="Get user"
        onPress={() => {
          setUserInfo(null);
          getUserCall();
          setError("");
        }}
      />
    </View>
  );
}
