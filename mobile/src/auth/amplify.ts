import { Amplify } from 'aws-amplify'

// configures amplify

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'us-east-2_hrmKv95ev',
      userPoolClientId: '2b5rc445sdhleckv3ml35ol5ad',

      loginWith: {
        email: true,
      },

      signUpVerificationMethod: 'code',

      userAttributes: {
        email: {
          required: true,
        },
      },
    },
  },
});