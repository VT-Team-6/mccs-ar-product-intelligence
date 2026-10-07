// for debug purposes, just lets the user click and see their information, as well as an admin only version

import { adminTest, getUser, User } from "@/api/general";
import { useState } from "react";
import { Button, Text, View } from "react-native";
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

  async function getAdmin() {
    try {
      const user = await adminTest();
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
      <Button
        title="Get admin"
        onPress={() => {
          setUserInfo(null);
          getAdmin();
          setError("");
        }}
      />
    </View>
  );
}
