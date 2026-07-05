import {
  DeleteCommand,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { getDocumentClient } from "./dynamo.js";
import { loadConfig } from "../config.js";

/** One registered push target: a device token + its SNS endpoint. Lives in
 *  the user's partition so sign-in devices ride along with the profile. */
export interface UserDevice {
  userId: string;
  token: string;
  endpointArn: string;
  platform: string;
  createdAt: string;
}

const userPk = (userId: string) => `USER#${userId}`;
const deviceSk = (token: string) => `DEVICE#${token}`;

export class DeviceStore {
  private readonly tableName: string;
  private readonly docClient = getDocumentClient();

  constructor() {
    this.tableName = loadConfig().tableName;
  }

  async saveDevice(device: UserDevice): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          entityType: "UserDevice",
          PK: userPk(device.userId),
          SK: deviceSk(device.token),
          ...device
        }
      })
    );
  }

  async listDevices(userId: string): Promise<UserDevice[]> {
    const { Items } = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": userPk(userId),
          ":sk": "DEVICE#"
        }
      })
    );
    return (Items ?? []).map((item) => ({
      userId,
      token: item.token as string,
      endpointArn: item.endpointArn as string,
      platform: (item.platform as string) ?? "ios",
      createdAt: item.createdAt as string
    }));
  }

  async deleteDevice(userId: string, token: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: userPk(userId), SK: deviceSk(token) }
      })
    );
  }
}
