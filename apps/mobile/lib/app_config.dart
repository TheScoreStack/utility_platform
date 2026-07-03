class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );
  static const String region = String.fromEnvironment(
    'AWS_REGION',
    defaultValue: 'us-east-1',
  );
  static const String userPoolId = String.fromEnvironment(
    'USER_POOL_ID',
    defaultValue: '',
  );
  static const String userPoolClientId = String.fromEnvironment(
    'USER_POOL_CLIENT_ID',
    defaultValue: '',
  );

  const AppConfig._();
}
