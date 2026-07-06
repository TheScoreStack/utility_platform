import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { loadConfig } from "../config.js";

let lambdaClient: LambdaClient | null = null;
const getLambdaClient = () => {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({ region: loadConfig().region });
  }
  return lambdaClient;
};

/**
 * Fire-and-forget re-invoke of the statement parser for an already-uploaded
 * object (retry after FAILED). The event mimics the S3 notification shape the
 * parser expects, plus a `harmonyRetry` marker so it skips the duplicate-event
 * claim (the caller has already moved the statement into PROCESSING).
 */
export const invokeStatementParser = async (
  storageKey: string
): Promise<void> => {
  const config = loadConfig();
  if (!config.parserFunctionName) {
    throw new Error("PARSER_FUNCTION_NAME is not configured");
  }

  const event = {
    Records: [
      {
        harmonyRetry: true,
        s3: {
          bucket: { name: config.receiptBucket },
          object: { key: storageKey, size: 0 }
        }
      }
    ]
  };

  await getLambdaClient().send(
    new InvokeCommand({
      FunctionName: config.parserFunctionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(event))
    })
  );
};
