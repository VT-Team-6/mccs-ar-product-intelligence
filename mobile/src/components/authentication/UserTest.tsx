// for debug purposes, just lets the user click and see their information, as well as an admin only version

import { adminTest, getUser, User } from "@/api/general";
import { useState } from "react";
import { Button, Text, View } from "react-native";

export default function UserTest() {
  const [userInfo, setUserInfo] = useState<User | null>();
  const [error, setError] = useState<string>("");

  async function getUserCall() {
    try {
      const user = await getUser();
      console.log(`working: ${user}`);
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
      <Text>{error}</Text>
      {userInfo && <Text>{JSON.stringify(userInfo, null, 2)}</Text>}
      <Button title="Get user" onPress={getUserCall} />
      <Button title="Get admin" onPress={getAdmin} />
    </View>
  );
}
