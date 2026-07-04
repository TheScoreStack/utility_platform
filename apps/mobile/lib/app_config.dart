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

  const AppConfig._();
}
