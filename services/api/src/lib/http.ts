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
  origin = "*"
): APIGatewayProxyStructuredResultV2 => {
  if (error instanceof ValidationError) {
    return json(400, { message: error.message }, origin);
  }
  if (error instanceof ForbiddenError) {
    return json(403, { message: error.message }, origin);
  }
  if (error instanceof NotFoundError) {
    return json(404, { message: error.message }, origin);
  }

  console.error("Unhandled error", error);
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
