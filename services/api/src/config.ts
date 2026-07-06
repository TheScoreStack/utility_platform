export interface AppConfig {
  region: string;
  tableName: string;
  receiptBucket: string;
  textractOutputBucket?: string;
  signedUrlExpirySeconds: number;
  /** SNS platform application for APNs pushes; unset = iOS pushes off. */
  pushPlatformAppArn?: string;
  /** SNS platform application for FCM pushes; unset = Android pushes off. */
  pushPlatformAppArnAndroid?: string;
  /** Bedrock model for statement parsing. */
  bedrockModelId: string;
  /** Region for Bedrock calls; defaults to the stack region. */
  bedrockRegion?: string;
  /** Statement parser Lambda name — enables the retry endpoint. */
  parserFunctionName?: string;
}

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const buildConfig = (): AppConfig => {
  const region =
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.REGION ||
    "us-east-1";

  return {
    region,
    tableName: required(process.env.TABLE_NAME, "TABLE_NAME"),
    receiptBucket: required(process.env.RECEIPT_BUCKET, "RECEIPT_BUCKET"),
    textractOutputBucket: process.env.TEXTRACT_OUTPUT_BUCKET,
    signedUrlExpirySeconds: process.env.SIGNED_URL_EXPIRY_SECONDS
      ? Number(process.env.SIGNED_URL_EXPIRY_SECONDS)
      : 900,
    pushPlatformAppArn: process.env.PUSH_PLATFORM_APP_ARN || undefined,
    pushPlatformAppArnAndroid:
      process.env.PUSH_PLATFORM_APP_ARN_ANDROID || undefined,
    bedrockModelId:
      process.env.BEDROCK_MODEL_ID || "anthropic.claude-haiku-4-5",
    bedrockRegion: process.env.BEDROCK_REGION || undefined,
    parserFunctionName: process.env.PARSER_FUNCTION_NAME || undefined
  };
};

let cachedConfig: AppConfig | null = null;

export const loadConfig = (): AppConfig => {
  if (!cachedConfig) {
    cachedConfig = buildConfig();
  }
  return cachedConfig;
};
