import {
  CreatePlatformEndpointCommand,
  DeleteEndpointCommand,
  PublishCommand,
  SNSClient
} from "@aws-sdk/client-sns";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { DeviceStore } from "../data/deviceStore.js";
import { ValidationError } from "../lib/errors.js";
import type { AuthContext } from "../auth.js";

const registerSchema = z.object({
  token: z.string().regex(/^[0-9a-fA-F]{32,512}$/, "Invalid device token"),
  platform: z.literal("ios").default("ios")
});

export interface PushMessage {
  title: string;
  body: string;
  /** Extra payload for future deep links (e.g. { tripId }). */
  data?: Record<string, string>;
}

/**
 * APNs pushes via an SNS platform application. The whole feature is inert
 * until PUSH_PLATFORM_APP_ARN is configured — registration becomes a no-op
 * and sends short-circuit, so the app works identically with or without it.
 */
export class PushService {
  private readonly deviceStore = new DeviceStore();
  private readonly platformAppArn = loadConfig().pushPlatformAppArn;
  private snsClient: SNSClient | null = null;

  get enabled(): boolean {
    return Boolean(this.platformAppArn);
  }

  private get sns(): SNSClient {
    this.snsClient ??= new SNSClient({ region: loadConfig().region });
    return this.snsClient;
  }

  async registerDevice(body: unknown, auth: AuthContext): Promise<void> {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    if (!this.enabled) return;

    const token = parsed.data.token.toLowerCase();
    const { EndpointArn } = await this.sns.send(
      new CreatePlatformEndpointCommand({
        PlatformApplicationArn: this.platformAppArn,
        Token: token,
        CustomUserData: auth.userId
      })
    );
    if (!EndpointArn) {
      throw new ValidationError("Could not register the device");
    }
    await this.deviceStore.saveDevice({
      userId: auth.userId,
      token,
      endpointArn: EndpointArn,
      platform: parsed.data.platform,
      createdAt: new Date().toISOString()
    });
  }

  async unregisterDevice(token: string, auth: AuthContext): Promise<void> {
    const devices = await this.deviceStore.listDevices(auth.userId);
    const device = devices.find(
      (item) => item.token === token.toLowerCase()
    );
    if (!device) return;
    await this.deviceStore.deleteDevice(auth.userId, device.token);
    try {
      await this.sns.send(
        new DeleteEndpointCommand({ EndpointArn: device.endpointArn })
      );
    } catch {
      // Orphaned endpoints are harmless; SNS disables them on failed sends.
    }
  }

  /** Sends to every device of every listed user. Never throws — callers
   *  fire-and-forget from request paths. */
  async notifyUsers(userIds: string[], message: PushMessage): Promise<void> {
    if (!this.enabled || !userIds.length) return;

    const apnsPayload = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: "default"
      },
      ...(message.data ?? {})
    });
    const snsMessage = JSON.stringify({
      default: message.body,
      APNS: apnsPayload,
      APNS_SANDBOX: apnsPayload
    });

    const targets = (
      await Promise.all(
        userIds.map((userId) =>
          this.deviceStore.listDevices(userId).catch(() => [])
        )
      )
    ).flat();

    await Promise.allSettled(
      targets.map(async (device) => {
        try {
          await this.sns.send(
            new PublishCommand({
              TargetArn: device.endpointArn,
              MessageStructure: "json",
              Message: snsMessage
            })
          );
        } catch (error) {
          const name = (error as { name?: string }).name ?? "";
          if (name === "EndpointDisabledException") {
            // The token went stale (app deleted, token rotated) — clean up.
            await this.deviceStore
              .deleteDevice(device.userId, device.token)
              .catch(() => {});
            await this.sns
              .send(new DeleteEndpointCommand({ EndpointArn: device.endpointArn }))
              .catch(() => {});
          } else {
            console.error(
              `Push to ${device.endpointArn} failed`,
              error
            );
          }
        }
      })
    );
  }
}

export const pushService = new PushService();

/** Fire-and-forget wrapper for request paths: pushes must never fail or
 *  slow down the API call that triggered them beyond the send itself. */
export const notifyUsersSafely = async (
  userIds: string[],
  message: PushMessage
): Promise<void> => {
  try {
    await pushService.notifyUsers(userIds, message);
  } catch (error) {
    console.error("Push notification batch failed", error);
  }
};
