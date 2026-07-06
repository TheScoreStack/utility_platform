import path from "node:path";

// Get the project root directory (works in both ESM and bundled CJS)
const getProjectRoot = () => {
  // When running from infra directory, process.cwd() gives us the infra dir
  // We need to go up one level to get the project root
  const cwd = process.cwd();
  if (cwd.endsWith("/infra")) {
    return path.dirname(cwd);
  }
  return cwd;
};

// Get the infra/src/stacks directory for relative path calculations
const getStackDir = () => {
  return path.join(getProjectRoot(), "infra/src/stacks");
};
import {
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  CfnOutput
} from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table
} from "aws-cdk-lib/aws-dynamodb";
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
  HttpMethods,
  EventType
} from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import {
  CfnStage,
  CorsHttpMethod,
  HttpApi,
  HttpMethod
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import {
  AccountRecovery,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolOperation
} from "aws-cdk-lib/aws-cognito";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Alarm, ComparisonOperator, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";

export class GroupExpensesStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const stackDir = getStackDir();

    const table = new Table(this, "ExpensesTable", {
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN
    });

    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    });

    table.addGlobalSecondaryIndex({
      indexName: "GSI2",
      partitionKey: { name: "GSI2PK", type: AttributeType.STRING },
      sortKey: { name: "GSI2SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    });

    table.addGlobalSecondaryIndex({
      indexName: "GSI3",
      partitionKey: { name: "GSI3PK", type: AttributeType.STRING },
      sortKey: { name: "GSI3SK", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL
    });

    const receiptBucket = new Bucket(this, "ReceiptBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: false,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [HttpMethods.PUT, HttpMethods.HEAD, HttpMethods.GET],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000
        }
      ],
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(730),
          prefix: "trips/"
        },
        {
          enabled: true,
          expiration: Duration.days(730),
          prefix: "harmony/"
        }
      ],
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: false
    });

    const userPool = new UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: false
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false
      }
    });

    const userPoolClient = new UserPoolClient(this, "UserPoolClient", {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true
        },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE]
      },
      generateSecret: false,
      preventUserExistenceErrors: true
    });

    const defaultFrontendDomains = [
      "https://thestackcore.com",
      "https://www.thestackcore.com",
      "https://main.dpco69rqpvn1l.amplifyapp.com",
      "https://dpco69rqpvn1l.amplifyapp.com"
    ];
    const configuredDomains =
      process.env.FRONTEND_DOMAINS?.split(",")
        .map((domain) => domain.trim())
        .filter(Boolean) ??
      (process.env.FRONTEND_DOMAIN ? [process.env.FRONTEND_DOMAIN] : []);
    const allowedOrigins = Array.from(
      new Set(["http://localhost:5173", ...defaultFrontendDomains, ...configuredDomains].filter(Boolean))
    );

    const sharedEnvironment = {
      ALLOWED_ORIGINS: allowedOrigins.join(","),
      ALLOWED_ORIGIN: allowedOrigins[0] ?? "http://localhost:5173"
    };

    const sharedFunctionProps = {
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      timeout: Duration.seconds(15),
      memorySize: 256,
      // All function entries live in services/api; point the lock file there
      // so NodejsFunction resolves projectRoot as services/api, not infra.
      depsLockFilePath: path.join(
        stackDir,
        "../../../services/api/package-lock.json"
      ),
      bundling: {
        format: OutputFormat.ESM,
        target: "node20",
        sourcemap: true,
        externalModules: ["aws-sdk"],
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);"
      }
    };

    // APNs pushes go through an SNS platform application created out-of-band
    // (needs the Apple signing key, which never touches this repo). The ARN
    // itself is not sensitive. Unset the env var AND this default to turn
    // pushes off entirely.
    const pushPlatformAppArn =
      process.env.PUSH_PLATFORM_APP_ARN ??
      "arn:aws:sns:us-east-1:972890651266:app/APNS/stackcore-apns";
    // Android counterpart (FCM).
    const pushPlatformAppArnAndroid =
      process.env.PUSH_PLATFORM_APP_ARN_ANDROID ??
      "arn:aws:sns:us-east-1:972890651266:app/GCM/stackcore-fcm";

    const httpLambda = new NodejsFunction(this, "HttpHandler", {
      ...sharedFunctionProps,
      entry: path.join(stackDir, "../../../services/api/src/handlers/http.ts"),
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        ...sharedEnvironment,
        TABLE_NAME: table.tableName,
        RECEIPT_BUCKET: receiptBucket.bucketName,
        SIGNED_URL_EXPIRY_SECONDS: "900",
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
        ...(pushPlatformAppArn
          ? { PUSH_PLATFORM_APP_ARN: pushPlatformAppArn }
          : {}),
        ...(pushPlatformAppArnAndroid
          ? { PUSH_PLATFORM_APP_ARN_ANDROID: pushPlatformAppArnAndroid }
          : {})
      }
    });

    const pushAppArns = [pushPlatformAppArn, pushPlatformAppArnAndroid].filter(
      Boolean
    );
    const pushPolicy = pushAppArns.length
      ? new PolicyStatement({
          actions: [
            "sns:CreatePlatformEndpoint",
            "sns:Publish",
            "sns:DeleteEndpoint",
            "sns:GetEndpointAttributes",
            "sns:SetEndpointAttributes"
          ],
          resources: pushAppArns.flatMap((arn) => [
            arn,
            `${arn.replace(":app/", ":endpoint/")}/*`
          ])
        })
      : null;
    if (pushPolicy) {
      httpLambda.addToRolePolicy(pushPolicy);
    }

    const textractLambda = new NodejsFunction(this, "TextractProcessor", {
      ...sharedFunctionProps,
      entry: path.join(
        stackDir,
        "../../../services/api/src/handlers/textractProcessor.ts"
      ),
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        ...sharedEnvironment,
        TABLE_NAME: table.tableName,
        RECEIPT_BUCKET: receiptBucket.bucketName,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1"
      }
    });

    // Parses uploaded bank/Venmo/PayPal statements with Claude on Bedrock.
    // Long timeout: a multi-page PDF statement is a single large model call.
    const harmonyParserLambda = new NodejsFunction(
      this,
      "HarmonyStatementParser",
      {
        ...sharedFunctionProps,
        timeout: Duration.minutes(5),
        memorySize: 1024,
        entry: path.join(
          stackDir,
          "../../../services/api/src/handlers/harmonyStatementParser.ts"
        ),
        logRetention: RetentionDays.ONE_WEEK,
        environment: {
          ...sharedEnvironment,
          TABLE_NAME: table.tableName,
          RECEIPT_BUCKET: receiptBucket.bucketName,
          BEDROCK_MODEL_ID:
            process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-haiku-4-5",
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          // Parse-finished pushes to the uploader.
          ...(pushPlatformAppArn
            ? { PUSH_PLATFORM_APP_ARN: pushPlatformAppArn }
            : {}),
          ...(pushPlatformAppArnAndroid
            ? { PUSH_PLATFORM_APP_ARN_ANDROID: pushPlatformAppArnAndroid }
            : {})
        }
      }
    );

    harmonyParserLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          "arn:aws:bedrock:*::foundation-model/anthropic.*",
          `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.*`
        ]
      })
    );
    // The Bedrock Mantle (Messages API) endpoint authorizes with its own
    // action/resource pair, separate from classic bedrock:InvokeModel.
    harmonyParserLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock-mantle:CreateInference"],
        resources: [
          `arn:aws:bedrock-mantle:*:${this.account}:project/*`
        ]
      })
    );
    if (pushPolicy) {
      harmonyParserLambda.addToRolePolicy(pushPolicy);
    }

    table.grantReadWriteData(httpLambda);
    table.grantReadWriteData(textractLambda);
    table.grantReadWriteData(harmonyParserLambda);

    // The /statements/{id}/retry endpoint re-invokes the parser directly.
    httpLambda.addEnvironment(
      "PARSER_FUNCTION_NAME",
      harmonyParserLambda.functionName
    );
    harmonyParserLambda.grantInvoke(httpLambda);
    const postConfirmationLambda = new NodejsFunction(
      this,
      "PostConfirmationHandler",
      {
        ...sharedFunctionProps,
        entry: path.join(
          stackDir,
          "../../../services/api/src/handlers/postConfirmation.ts"
        ),
        logRetention: RetentionDays.ONE_WEEK,
        environment: {
          TABLE_NAME: table.tableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1"
        }
      }
    );

    table.grantReadWriteData(postConfirmationLambda);
    userPool.addTrigger(UserPoolOperation.POST_CONFIRMATION, postConfirmationLambda);
    receiptBucket.grantPut(httpLambda);
    receiptBucket.grantRead(httpLambda);
    // Statement deletion removes the uploaded object.
    receiptBucket.grantDelete(httpLambda);
    receiptBucket.grantRead(textractLambda);
    receiptBucket.grantRead(harmonyParserLambda);

    const weeklyDigestLambda = new NodejsFunction(this, "WeeklyDigestHandler", {
      ...sharedFunctionProps,
      timeout: Duration.minutes(2),
      memorySize: 512,
      entry: path.join(
        stackDir,
        "../../../services/api/src/handlers/weeklyDigest.ts"
      ),
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        TABLE_NAME: table.tableName,
        RECEIPT_BUCKET: receiptBucket.bucketName,
        DIGEST_FROM_EMAIL:
          process.env.DIGEST_FROM_EMAIL ?? "The Stack Core <digest@thestackcore.com>",
        APP_URL: process.env.APP_URL ?? "https://thestackcore.com",
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1"
      }
    });

    table.grantReadData(weeklyDigestLambda);
    weeklyDigestLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"]
      })
    );

    new Rule(this, "WeeklyDigestSchedule", {
      schedule: Schedule.cron({
        minute: "0",
        hour: "14",
        weekDay: "SUN"
      }),
      targets: [new LambdaFunction(weeklyDigestLambda)],
      description: "Fires the weekly group-expenses digest every Sunday 14:00 UTC"
    });

    const recurringExpensesLambda = new NodejsFunction(
      this,
      "RecurringExpensesHandler",
      {
        ...sharedFunctionProps,
        timeout: Duration.minutes(2),
        memorySize: 512,
        entry: path.join(
          stackDir,
          "../../../services/api/src/handlers/recurringExpenses.ts"
        ),
        logRetention: RetentionDays.ONE_WEEK,
        environment: {
          TABLE_NAME: table.tableName,
          RECEIPT_BUCKET: receiptBucket.bucketName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          ...(pushPlatformAppArn
            ? { PUSH_PLATFORM_APP_ARN: pushPlatformAppArn }
            : {}),
          ...(pushPlatformAppArnAndroid
            ? { PUSH_PLATFORM_APP_ARN_ANDROID: pushPlatformAppArnAndroid }
            : {})
        }
      }
    );
    table.grantReadWriteData(recurringExpensesLambda);
    if (pushAppArns.length) {
      recurringExpensesLambda.addToRolePolicy(
        new PolicyStatement({
          actions: [
            "sns:CreatePlatformEndpoint",
            "sns:Publish",
            "sns:DeleteEndpoint",
            "sns:GetEndpointAttributes",
            "sns:SetEndpointAttributes"
          ],
          resources: pushAppArns.flatMap((arn) => [
            arn,
            `${arn.replace(":app/", ":endpoint/")}/*`
          ])
        })
      );
    }

    const harmonyRecurringLambda = new NodejsFunction(
      this,
      "HarmonyRecurringHandler",
      {
        ...sharedFunctionProps,
        timeout: Duration.minutes(2),
        entry: path.join(
          stackDir,
          "../../../services/api/src/handlers/harmonyRecurring.ts"
        ),
        logRetention: RetentionDays.ONE_WEEK,
        environment: {
          TABLE_NAME: table.tableName,
          RECEIPT_BUCKET: receiptBucket.bucketName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1"
        }
      }
    );
    table.grantReadWriteData(harmonyRecurringLambda);

    new Rule(this, "RecurringExpensesSchedule", {
      schedule: Schedule.cron({
        minute: "5",
        hour: "13"
      }),
      targets: [
        new LambdaFunction(recurringExpensesLambda),
        new LambdaFunction(harmonyRecurringLambda)
      ],
      description:
        "Materializes due recurring expenses daily at 13:05 UTC (morning in the US)"
    });

    textractLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["textract:AnalyzeExpense"],
        resources: ["*"]
      })
    );

    httpLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["textract:AnalyzeExpense"],
        resources: ["*"]
      })
    );

    receiptBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(textractLambda),
      { prefix: "trips/" }
    );

    receiptBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(harmonyParserLambda),
      { prefix: "harmony/statements/" }
    );

    const httpApi = new HttpApi(this, "GroupExpensesApi", {
      apiName: "GroupExpenses",
      corsPreflight: {
        allowCredentials: true,
        allowHeaders: ["*"],
        allowMethods: [CorsHttpMethod.ANY],
        allowOrigins: allowedOrigins,
        maxAge: Duration.hours(12)
      }
    });

    const httpIntegration = new HttpLambdaIntegration(
      "HttpHandlerIntegration",
      httpLambda
    );

    const authorizer = new HttpUserPoolAuthorizer("UserPoolAuthorizer", userPool, {
      userPoolClients: [userPoolClient]
    });

    httpApi.addRoutes({
      path: "/trips",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: httpIntegration,
      authorizer
    });

    httpApi.addRoutes({
      path: "/trips/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PATCH, HttpMethod.DELETE],
      integration: httpIntegration,
      authorizer
    });

    httpApi.addRoutes({
      path: "/users",
      methods: [HttpMethod.GET],
      integration: httpIntegration,
      authorizer
    });

    httpApi.addRoutes({
      path: "/profile",
      methods: [HttpMethod.GET, HttpMethod.PATCH, HttpMethod.DELETE],
      integration: httpIntegration,
      authorizer
    });

    httpApi.addRoutes({
      path: "/profile/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PATCH, HttpMethod.DELETE],
      integration: httpIntegration,
      authorizer
    });

    httpApi.addRoutes({
      path: "/invites/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: httpIntegration,
      authorizer
    });

    httpApi.addRoutes({
      path: "/harmony-ledger/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE, HttpMethod.PATCH],
      integration: httpIntegration,
      authorizer
    });

    httpApi.addRoutes({
      path: "/stack-time/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE, HttpMethod.PATCH],
      integration: httpIntegration,
      authorizer
    });

    httpApi.addRoutes({
      path: "/meet/{proxy+}",
      methods: [
        HttpMethod.GET,
        HttpMethod.POST,
        HttpMethod.PATCH,
        HttpMethod.PUT,
        HttpMethod.DELETE
      ],
      integration: httpIntegration,
      authorizer
    });

    // Deliberately unauthenticated: meet respond links work without an
    // account. Access control is capability-based (unguessable slug +
    // per-participant secret) and enforced in the handler.
    httpApi.addRoutes({
      path: "/meet-public/{proxy+}",
      methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.PUT],
      integration: httpIntegration
    });

    // The public meet routes are the API's first unauthenticated surface;
    // HTTP APIs only throttle per stage, so cap the whole default stage.
    const defaultStage = httpApi.defaultStage?.node.defaultChild as CfnStage;
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: 25,
      throttlingBurstLimit: 100
    };

    new CfnOutput(this, "ApiEndpoint", {
      value: httpApi.apiEndpoint
    });

    new CfnOutput(this, "WebEnvViteApiUrl", {
      value: `VITE_API_URL=${httpApi.apiEndpoint}`,
      description: "Copy-paste env var for the web app"
    });

    new CfnOutput(this, "WebEnvViteRegion", {
      value: `VITE_REGION=${this.region}`,
      description: "Copy-paste env var for the web app"
    });

    new CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId
    });

    new CfnOutput(this, "WebEnvViteUserPoolId", {
      value: `VITE_USER_POOL_ID=${userPool.userPoolId}`,
      description: "Copy-paste env var for the web app"
    });

    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId
    });

    new CfnOutput(this, "WebEnvViteUserPoolClientId", {
      value: `VITE_USER_POOL_CLIENT_ID=${userPoolClient.userPoolClientId}`,
      description: "Copy-paste env var for the web app"
    });

    new CfnOutput(this, "ReceiptBucketName", {
      value: receiptBucket.bucketName
    });

    // ------------------------------------------------------------- alarms
    // Every Lambda failure emails ops — these paths otherwise fail silently
    // (scheduled jobs, async Textract, push sends).
    const opsTopic = new Topic(this, "OpsAlerts", {
      displayName: "Stack Core ops alerts"
    });
    opsTopic.addSubscription(
      new EmailSubscription(
        process.env.OPS_ALERT_EMAIL ?? "hunter.j.adam@gmail.com"
      )
    );

    const alarmOnErrors = (
      id: string,
      fn: NodejsFunction,
      description: string
    ) => {
      new Alarm(this, id, {
        metric: fn.metricErrors({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator:
          ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: TreatMissingData.NOT_BREACHING,
        alarmDescription: description
      }).addAlarmAction(new SnsAction(opsTopic));
    };

    alarmOnErrors(
      "HttpErrorsAlarm",
      httpLambda,
      "Stack Core API handler is throwing errors"
    );
    alarmOnErrors(
      "TextractErrorsAlarm",
      textractLambda,
      "Receipt OCR processor is failing — scans will hang for users"
    );
    alarmOnErrors(
      "HarmonyParserErrorsAlarm",
      harmonyParserLambda,
      "Harmony statement parser is failing — statement imports will hang"
    );
    alarmOnErrors(
      "HarmonyRecurringErrorsAlarm",
      harmonyRecurringLambda,
      "Harmony recurring materializer failed — scheduled entries are not posting"
    );
    alarmOnErrors(
      "RecurringErrorsAlarm",
      recurringExpensesLambda,
      "Recurring-expense scheduler failed — templates are not materializing"
    );
    alarmOnErrors(
      "DigestErrorsAlarm",
      weeklyDigestLambda,
      "Weekly digest emailer failed"
    );
    alarmOnErrors(
      "PostConfirmationErrorsAlarm",
      postConfirmationLambda,
      "Cognito post-confirmation failed — new signups may lack profiles"
    );

    new CfnOutput(this, "DynamoTableName", {
      value: table.tableName
    });
  }
}
