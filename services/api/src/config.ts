export interface AppConfig {
  region: string;
  tableName: string;
  receiptBucket: string;
  textractOutputBucket?: string;
  signedUrlExpirySeconds: number;
  /** SNS platform application for APNs pushes; unset = pushes disabled. */
  pushPlatformAppArn?: string;
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
    pushPlatformAppArn: process.env.PUSH_PLATFORM_APP_ARN || undefined
  };
};

let cachedConfig: AppConfig | null = null;

export const loadConfig = (): AppConfig => {
  if (!cachedConfig) {
    cachedConfig = buildConfig();
  }
  return cachedConfig;
};
