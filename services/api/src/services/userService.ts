import { z } from "zod";
import type { AuthContext } from "../auth.js";
import { ValidationError } from "../lib/errors.js";
import { UserStore } from "../data/userStore.js";
import type { UserProfile } from "../types.js";

const userStore = new UserStore();

const searchSchema = z.object({
  query: z.string().min(1).max(255)
});

const paymentMethodField = z.union([z.string().trim().min(1), z.null()]).optional();

const paymentMethodsSchema = z
  .object({
    venmo: paymentMethodField,
    paypal: paymentMethodField,
    zelle: paymentMethodField,
    primary: z.union([z.enum(["venmo", "paypal", "zelle"]), z.null()]).optional()
  })
  .superRefine((value, ctx) => {
    const hasValue = Object.values(value).some((item) => item !== undefined);
    if (!hasValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one payment method must be provided"
      });
    }
  });

export class UserService {
  async searchUsers(
    params: Record<string, string | undefined>,
    auth: AuthContext
  ): Promise<UserProfile[]> {
    await userStore.ensureUserProfile(auth);

    const parsed = searchSchema.safeParse({
      query: params.query ?? params.q
    });

    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    return userStore.searchUsers(parsed.data.query, 10);
  }

  async getProfile(auth: AuthContext): Promise<UserProfile> {
    return userStore.ensureUserProfile(auth);
  }

  /** Deletes the caller's platform data (profile + search entries). The
   *  client is expected to delete the Cognito account afterwards; this call
   *  is idempotent so a failed Cognito step can simply retry the pair. */
  async deleteAccount(auth: AuthContext): Promise<void> {
    await userStore.deleteUserProfile(auth.userId);
  }

  async updateProfile(
    body: unknown,
    auth: AuthContext
  ): Promise<UserProfile> {
    const parsed = paymentMethodsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await userStore.ensureUserProfile(auth);

    const cleaned: Partial<
      Record<keyof NonNullable<UserProfile["paymentMethods"]>, string | null>
    > = {};
    (["venmo", "paypal", "zelle", "primary"] as const).forEach((key) => {
      const value = parsed.data[key];
      if (value === undefined) return;
      cleaned[key] = value === null ? null : value.trim();
    });

    // A preferred method has to point at a handle that will exist after
    // this update.
    if (typeof cleaned.primary === "string") {
      const current = await userStore.getUser(auth.userId);
      const merged = { ...(current?.paymentMethods ?? {}), ...cleaned };
      if (!merged[cleaned.primary as "venmo" | "paypal" | "zelle"]) {
        throw new ValidationError(
          "Add a handle for your preferred method before making it primary"
        );
      }
    }

    await userStore.updatePaymentMethods(auth.userId, cleaned);

    const updated = await userStore.getUser(auth.userId);
    if (!updated) {
      throw new ValidationError("Profile not found");
    }
    return updated;
  }

  async setEmailDigestPreference(
    body: unknown,
    auth: AuthContext
  ): Promise<UserProfile> {
    const parsed = z.object({ optIn: z.boolean() }).safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    await userStore.ensureUserProfile(auth);
    await userStore.setEmailDigestPreference(auth.userId, parsed.data.optIn);
    const updated = await userStore.getUser(auth.userId);
    if (!updated) {
      throw new ValidationError("Profile not found");
    }
    return updated;
  }
}
