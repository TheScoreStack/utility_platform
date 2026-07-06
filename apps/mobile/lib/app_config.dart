/// Backend configuration. The defaults are the production values — none of
/// them are secrets (they ship inside the web bundle too), and baking them
/// in means release builds work without any --dart-define flags. Pass
/// --dart-define to override for local/dev backends.
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://i2cf7yum3c.execute-api.us-east-1.amazonaws.com',
  );
  static const String region = String.fromEnvironment(
    'AWS_REGION',
    defaultValue: 'us-east-1',
  );
  static const String userPoolId = String.fromEnvironment(
    'USER_POOL_ID',
    defaultValue: 'us-east-1_Tg0h2HObX',
  );
  static const String userPoolClientId = String.fromEnvironment(
    'USER_POOL_CLIENT_ID',
    defaultValue: 'dbfdh3ss23c78dv4pr1vapl23',
  );

  // Firebase Android app config (FCM pushes). These are public client
  // values from the Firebase console — same category as the pool ids above.
  // All four empty = Android push registration quietly skips itself.
  static const String firebaseAndroidApiKey = String.fromEnvironment(
    'FIREBASE_ANDROID_API_KEY',
    defaultValue: 'AIzaSyBRCqL9zEa3FP0q41Oicq36b7T5U6vsTb4',
  );
  static const String firebaseAndroidAppId = String.fromEnvironment(
    'FIREBASE_ANDROID_APP_ID',
    defaultValue: '1:57581880967:android:da8f48332c46b520a55a22',
  );
  static const String firebaseMessagingSenderId = String.fromEnvironment(
    'FIREBASE_MESSAGING_SENDER_ID',
    defaultValue: '57581880967',
  );
  static const String firebaseProjectId = String.fromEnvironment(
    'FIREBASE_PROJECT_ID',
    defaultValue: 'thestackcore',
  );

  static bool get firebaseAndroidConfigured =>
      firebaseAndroidApiKey.isNotEmpty &&
      firebaseAndroidAppId.isNotEmpty &&
      firebaseMessagingSenderId.isNotEmpty &&
      firebaseProjectId.isNotEmpty;

  // iOS Firebase app (Crashlytics only — pushes use native APNs). Same
  // Firebase project; each platform gets its own appId/apiKey.
  static const String firebaseIosApiKey = String.fromEnvironment(
    'FIREBASE_IOS_API_KEY',
    defaultValue: 'AIzaSyAogCgjxKdvYLI-dFK9lBKf8IiW754EqdA',
  );
  static const String firebaseIosAppId = String.fromEnvironment(
    'FIREBASE_IOS_APP_ID',
    defaultValue: '1:57581880967:ios:1fa3016343921988a55a22',
  );

  static bool get firebaseIosConfigured =>
      firebaseIosApiKey.isNotEmpty &&
      firebaseIosAppId.isNotEmpty &&
      firebaseMessagingSenderId.isNotEmpty &&
      firebaseProjectId.isNotEmpty;

  const AppConfig._();
}
