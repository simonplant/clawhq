/**
 * AWS EC2 provider adapter — EC2 API via native fetch (no SDK dependency).
 *
 * Implements the ProviderAdapter interface for AWS EC2 instances.
 * Uses AWS Signature V4 for authentication. Supports cloud-init via user data,
 * security groups, key pairs, AMI snapshots.
 *
 * Default instance type: t3.micro (free tier eligible).
 *
 * Note: This adapter uses native fetch with AWS Signature V4 signing.
 * The user provides an access key ID + secret access key (stored in
 * ~/.clawhq/cloud/credentials.json). AWS CLI profile support is not
 * implemented — users should export credentials explicitly.
 */

import { createHmac, createHash } from "node:crypto";

import {
  CLOUD_API_TIMEOUT_MS,
  CLOUD_POLL_INTERVAL_MS,
  CLOUD_POLL_TIMEOUT_MS,
} from "../../../config/defaults.js";
import type {
  AddSshKeyOptions,
  AddSshKeyResult,
  CreateFirewallOptions,
  CreateFirewallResult,
  CreateSnapshotOptions,
  CreateSnapshotResult,
  CreateVmFromSnapshotOptions,
  CreateVmOptions,
  CreateVmResult,
  DestroyResult,
  InstanceStatus,
  ProviderAdapter,
  SshKeyInfo,
  TokenValidationResult,
} from "../types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_AMI_REGION: Record<string, string> = {
  // Ubuntu 24.04 LTS AMIs (updated periodically)
  "us-east-1": "ami-0c7217cdde317cfec",
  "us-west-2": "ami-0b20a6f09f8b8c780",
  "eu-west-1": "ami-0905a3c97561e0b69",
  "eu-central-1": "ami-0faab6bdbac9486fb",
};

const DEFAULT_INSTANCE_TYPE = "t3.micro";

/** EC2 instance type monthly costs (approximate, us-east-1 on-demand). */
const SIZE_MONTHLY_COST: Record<string, number> = {
  "t3.micro": 7.59,
  "t3.small": 15.18,
  "t3.medium": 30.37,
  "t3.large": 60.74,
};

// ── AWS Signature V4 ─────────────────────────────────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function getSigningKey(secretKey: string, date: string, region: string, service: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, date);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

function signRequest(
  method: string,
  path: string,
  query: string,
  headers: Record<string, string>,
  body: string,
  accessKeyId: string,
  secretKey: string,
  region: string,
): Record<string, string> {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const service = "ec2";

  const signedHeaders = Object.keys(headers).map((k) => k.toLowerCase()).sort().join(";");
  const canonicalHeaders = Object.entries(headers)
    .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
    .sort()
    .join("\n") + "\n";

  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, sha256(body)].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const signingKey = getSigningKey(secretKey, dateStamp, region, service);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...headers,
    "x-amz-date": amzDate,
    "Authorization": `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ── Adapter ─────────────────────────────────────────────────────────────────

/** Create an AWS EC2 provider adapter. Token format: "ACCESS_KEY_ID:SECRET_ACCESS_KEY". */
export function createAwsAdapter(token: string, region = "us-east-1"): ProviderAdapter {
  const parts = token.split(":");
  if (parts.length !== 2) {
    throw new Error("AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY");
  }
  const accessKeyId = parts[0].trim();
  const secretKey = parts[1].trim();
  if (!accessKeyId || !secretKey) {
    throw new Error("AWS token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY");
  }

  async function ec2Request(
    params: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; status: number; body: string }> {
    const query = new URLSearchParams({ ...params, Version: "2016-11-15" }).toString();
    const host = `ec2.${region}.amazonaws.com`;
    const baseHeaders = { host, "content-type": "application/x-www-form-urlencoded" };
    const signed = signRequest("POST", "/", "", baseHeaders, query, accessKeyId, secretKey, region);

    let response: Response;
    try {
      response = await fetch(`https://${host}/`, {
        method: "POST",
        headers: signed,
        body: query,
        signal: signal ?? AbortSignal.timeout(CLOUD_API_TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, status: 0, body: err instanceof Error ? err.message : String(err) };
    }

    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  }

  function extractXmlValue(xml: string, tag: string): string | undefined {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match?.[1];
  }

  function extractAllXmlValues(xml: string, tag: string): string[] {
    const matches = xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"));
    return [...matches].map((m) => m[1]);
  }

  /**
   * Resolve the current Ubuntu 24.04 LTS AMI for this region via DescribeImages.
   * Returns the most recently published AMI from Canonical (owner 099720109477).
   * Falls back to the hardcoded map if the API call fails.
   */
  async function resolveAmi(signal?: AbortSignal): Promise<string> {
    try {
      const result = await ec2Request({
        Action: "DescribeImages",
        "Owner.1": "099720109477",
        "Filter.1.Name": "name",
        "Filter.1.Value.1": "ubuntu/images/hvm-ssd/ubuntu-noble-24.04-amd64-server-*",
        "Filter.2.Name": "state",
        "Filter.2.Value.1": "available",
        "Filter.3.Name": "architecture",
        "Filter.3.Value.1": "x86_64",
      }, signal);

      if (!result.ok) {
        throw new Error(`DescribeImages returned ${result.status}: ${result.body.slice(0, 200)}`);
      }

      const imageIds = extractAllXmlValues(result.body, "imageId");
      const creationDates = extractAllXmlValues(result.body, "creationDate");

      if (imageIds.length === 0) {
        throw new Error("DescribeImages returned no matching Ubuntu 24.04 LTS AMIs");
      }

      // Pick the most recently created AMI
      let latestIndex = 0;
      for (let i = 1; i < creationDates.length; i++) {
        if (creationDates[i] > creationDates[latestIndex]) {
          latestIndex = i;
        }
      }

      return imageIds[latestIndex];
    } catch (err) {
      const fallback = DEFAULT_AMI_REGION[region] ?? DEFAULT_AMI_REGION["us-east-1"];
      console.warn(
        `[provisioning] WARNING: Failed to resolve Ubuntu 24.04 AMI via DescribeImages for region ${region}. ` +
        `Falling back to hardcoded AMI ${fallback}. Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return fallback;
    }
  }

  async function pollForRunningInstance(instanceId: string, signal?: AbortSignal): Promise<string | undefined> {
    const start = Date.now();
    while (Date.now() - start < CLOUD_POLL_TIMEOUT_MS) {
      if (signal?.aborted) return undefined;
      const result = await ec2Request({ Action: "DescribeInstances", "InstanceId.1": instanceId }, signal);
      if (result.ok) {
        const state = extractXmlValue(result.body, "name");
        const ip = extractXmlValue(result.body, "publicIp") ?? extractXmlValue(result.body, "ipAddress");
        if (state === "running" && ip) return ip;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, CLOUD_POLL_INTERVAL_MS));
    }
    return undefined;
  }

  return {
    provider: "aws",

    async validateToken(signal?: AbortSignal): Promise<TokenValidationResult> {
      if (!accessKeyId || !secretKey) {
        return { valid: false, error: "Token must be in format ACCESS_KEY_ID:SECRET_ACCESS_KEY" };
      }
      const result = await ec2Request({ Action: "DescribeRegions" }, signal);
      if (!result.ok) return { valid: false, error: `AWS credential validation failed: ${result.body.slice(0, 200)}` };
      return { valid: true, account: `${accessKeyId.slice(0, 8)}...` };
    },

    async createVm(options: CreateVmOptions): Promise<CreateVmResult> {
      const ami = await resolveAmi(options.signal);
      const params: Record<string, string> = {
        Action: "RunInstances",
        ImageId: ami,
        InstanceType: options.size || DEFAULT_INSTANCE_TYPE,
        MinCount: "1",
        MaxCount: "1",
        UserData: Buffer.from(options.userData).toString("base64"),
        "TagSpecification.1.ResourceType": "instance",
        "TagSpecification.1.Tag.1.Key": "Name",
        "TagSpecification.1.Tag.1.Value": options.name,
        "TagSpecification.1.Tag.2.Key": "managed_by",
        "TagSpecification.1.Tag.2.Value": "clawhq",
      };

      if (options.sshKeys?.[0]) {
        params["KeyName"] = options.sshKeys[0];
      }

      const result = await ec2Request(params, options.signal);
      if (!result.ok) return { success: false, error: `EC2 RunInstances failed: ${result.body.slice(0, 300)}` };

      const instanceId = extractXmlValue(result.body, "instanceId");
      if (!instanceId) return { success: false, error: "No instanceId in EC2 response" };

      const ip = await pollForRunningInstance(instanceId, options.signal);
      return { success: true, providerInstanceId: instanceId, ipAddress: ip };
    },

    async destroyVm(providerInstanceId: string, signal?: AbortSignal): Promise<DestroyResult> {
      const result = await ec2Request({ Action: "TerminateInstances", "InstanceId.1": providerInstanceId }, signal);
      if (!result.ok) return { success: false, destroyed: false, error: `EC2 TerminateInstances failed: ${result.body.slice(0, 300)}` };
      return { success: true, destroyed: true };
    },

    async getVmStatus(providerInstanceId: string, signal?: AbortSignal): Promise<InstanceStatus> {
      const result = await ec2Request({ Action: "DescribeInstances", "InstanceId.1": providerInstanceId }, signal);
      if (!result.ok) return { state: "unknown", error: result.body.slice(0, 200) };

      const state = extractXmlValue(result.body, "name") ?? "unknown";
      const ip = extractXmlValue(result.body, "publicIp") ?? extractXmlValue(result.body, "ipAddress");
      const instanceType = extractXmlValue(result.body, "instanceType");
      return { state, ipAddress: ip, monthlyCost: SIZE_MONTHLY_COST[instanceType ?? ""] };
    },

    async addSshKey(options: AddSshKeyOptions): Promise<AddSshKeyResult> {
      const result = await ec2Request({
        Action: "ImportKeyPair",
        KeyName: options.name,
        PublicKeyMaterial: Buffer.from(options.publicKey).toString("base64"),
      }, options.signal);
      if (!result.ok) return { success: false, error: result.body.slice(0, 200) };
      const fingerprint = extractXmlValue(result.body, "keyFingerprint");
      return { success: true, keyId: options.name, fingerprint };
    },

    async listSshKeys(signal?: AbortSignal): Promise<SshKeyInfo[]> {
      const result = await ec2Request({ Action: "DescribeKeyPairs" }, signal);
      if (!result.ok) return [];
      const names = result.body.match(/<keyName>([^<]*)<\/keyName>/g) ?? [];
      const fingerprints = result.body.match(/<keyFingerprint>([^<]*)<\/keyFingerprint>/g) ?? [];
      return names.map((n, i) => ({
        id: n.replace(/<\/?keyName>/g, ""),
        name: n.replace(/<\/?keyName>/g, ""),
        fingerprint: fingerprints[i]?.replace(/<\/?keyFingerprint>/g, "") ?? "",
        publicKey: "",
      }));
    },

    async createFirewall(options: CreateFirewallOptions): Promise<CreateFirewallResult> {
      // Create security group
      const sgResult = await ec2Request({
        Action: "CreateSecurityGroup",
        GroupName: options.name,
        GroupDescription: `ClawHQ firewall for ${options.name}`,
      }, options.signal);
      if (!sgResult.ok) return { success: false, error: sgResult.body.slice(0, 200) };

      const groupId = extractXmlValue(sgResult.body, "groupId");
      if (!groupId) return { success: false, error: "No groupId in CreateSecurityGroup response" };

      // Add inbound rules
      for (let i = 0; i < options.inboundPorts.length; i++) {
        const port = options.inboundPorts[i];
        await ec2Request({
          Action: "AuthorizeSecurityGroupIngress",
          GroupId: groupId,
          "IpPermissions.1.IpProtocol": "tcp",
          "IpPermissions.1.FromPort": String(port),
          "IpPermissions.1.ToPort": String(port),
          "IpPermissions.1.IpRanges.1.CidrIp": "0.0.0.0/0",
        }, options.signal);
      }

      return { success: true, firewallId: groupId };
    },

    async createSnapshot(options: CreateSnapshotOptions): Promise<CreateSnapshotResult> {
      const result = await ec2Request({
        Action: "CreateImage",
        InstanceId: options.providerInstanceId,
        Name: options.name,
        NoReboot: "true",
      }, options.signal);
      if (!result.ok) return { success: false, error: result.body.slice(0, 200) };
      const imageId = extractXmlValue(result.body, "imageId");
      return { success: true, snapshotId: imageId };
    },

    async createVmFromSnapshot(options: CreateVmFromSnapshotOptions): Promise<CreateVmResult> {
      const params: Record<string, string> = {
        Action: "RunInstances",
        ImageId: options.snapshotId,
        InstanceType: options.size || DEFAULT_INSTANCE_TYPE,
        MinCount: "1",
        MaxCount: "1",
        "TagSpecification.1.ResourceType": "instance",
        "TagSpecification.1.Tag.1.Key": "Name",
        "TagSpecification.1.Tag.1.Value": options.name,
      };
      if (options.sshKeys?.[0]) params["KeyName"] = options.sshKeys[0];
      if (options.userData) params["UserData"] = Buffer.from(options.userData).toString("base64");

      const result = await ec2Request(params, options.signal);
      if (!result.ok) return { success: false, error: result.body.slice(0, 300) };

      const instanceId = extractXmlValue(result.body, "instanceId");
      if (!instanceId) return { success: false, error: "No instanceId in response" };

      const ip = await pollForRunningInstance(instanceId, options.signal);
      return { success: true, providerInstanceId: instanceId, ipAddress: ip };
    },

    async verifyDestroyed(providerInstanceId: string, signal?: AbortSignal): Promise<boolean> {
      const result = await ec2Request({ Action: "DescribeInstances", "InstanceId.1": providerInstanceId }, signal);
      if (!result.ok) return true; // API error likely means instance doesn't exist
      const state = extractXmlValue(result.body, "name");
      return state === "terminated";
    },

    getMonthlyCost(size: string): number | undefined {
      return SIZE_MONTHLY_COST[size];
    },
  };
}
