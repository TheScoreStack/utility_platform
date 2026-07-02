import { Amplify } from "aws-amplify";
import { appConfig } from "./config";

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: appConfig.userPoolId,
      userPoolClientId: appConfig.userPoolClientId,
      loginWith: {
        email: true
      }
    }
  }
});
