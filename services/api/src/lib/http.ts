import type {
  APIGatewayProxyStructuredResultV2,
  APIGatewayProxyEventV2
} from "aws-lambda";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors.js";

const buildHeaders = (origin: string) => ({
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Credentials": "true",
  Vary: "Origin"
});

export const json = (
  statusCode: number,
  body: unknown,
  origin = "*"
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: buildHeaders(origin),
  body: JSON.stringify(body)
});

export const handleError = (
  error: unknown,
  origin = "*",
  context?: string
): APIGatewayProxyStructuredResultV2 => {
  // 4xx responses are client-visible but were previously invisible in logs,
  // which made field issues undiagnosable. Log them with their route.
  if (error instanceof ValidationError) {
    console.warn("Request rejected (400)", { context, message: error.message });
    return json(400, { message: error.message }, origin);
  }
  if (error instanceof ForbiddenError) {
    console.warn("Request rejected (403)", { context, message: error.message });
    return json(403, { message: error.message }, origin);
  }
  if (error instanceof NotFoundError) {
    console.warn("Request rejected (404)", { context, message: error.message });
    return json(404, { message: error.message }, origin);
  }

  console.error("Unhandled error", { context, error });
  return json(500, { message: "Internal server error" }, origin);
};

export const parseBody = <T = unknown>(
  event: APIGatewayProxyEventV2
): T | null => {
  if (!event.body) {
    return null;
  }
  try {
    return JSON.parse(event.body) as T;
  } catch {
    throw new ValidationError("Invalid JSON body");
  }
};

export const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  Vary: "Origin"
});

export const preflightResponse = (origin: string): APIGatewayProxyStructuredResultV2 => ({
  statusCode: 204,
  headers: corsHeaders(origin)
});
