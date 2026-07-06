import { fetchAuthSession } from "@aws-amplify/auth";
import { appConfig } from "../config";
import type { PaymentMethods, UserProfile } from "../types";

class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

const buildUrl = (path: string): string => {
  if (path.startsWith("http")) return path;
  return `${appConfig.apiUrl}${path}`;
};

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

const request = async <T>(
  method: string,
  path: string,
  options: RequestOptions = {}
): Promise<T> => {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken ?? session.tokens?.accessToken;
  if (!token) {
    throw new ApiError("Unable to resolve auth token", 401);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.toString()}`,
    ...options.headers
  };

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(buildUrl(path), {
    method,
    headers,
    body
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : (undefined as T);

  if (!response.ok) {
    const message = (data as { message?: string } | undefined)?.message;
    throw new ApiError(message ?? response.statusText, response.status);
  }

  return data;
};

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>("DELETE", path, body === undefined ? {} : { body })
};

export { ApiError };

export const searchUsers = (query: string) =>
  request<{ users: UserProfile[] }>(
    "GET",
    `/users?query=${encodeURIComponent(query)}`
  );

export const getProfile = () =>
  request<{ profile: UserProfile }>("GET", "/profile");

export const updateProfile = (
  methods: Partial<Record<keyof PaymentMethods, string | null>>
) => request<{ profile: UserProfile }>("PATCH", "/profile", { body: methods });
