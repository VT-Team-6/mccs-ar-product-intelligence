import { Amplify } from "aws-amplify";
import { Platform } from "react-native";

const redirectSignIn =
  Platform.OS === "web" ? "http://localhost:8081" : "mobile://";

const redirectSignOut =
  Platform.OS === "web" ? "http://localhost:8081" : "mobile://";

// configures amplify
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID!,
      userPoolClientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID!,

      loginWith: {
        oauth: {
          domain: process.env.EXPO_PUBLIC_COGNITO_DOMAIN!,

          scopes: [
            "openid",
            "email",
            "profile",
            "aws.cognito.signin.user.admin",
          ],

          redirectSignIn: [redirectSignIn],
          redirectSignOut: [redirectSignOut],

          responseType: "code",
        },
      },

      userAttributes: {
        email: {
          required: true,
        },
      },
    },
  },
});
