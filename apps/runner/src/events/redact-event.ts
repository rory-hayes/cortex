import { redactLogText } from "@control-plane/logging";

const SECRET_REDACTION = "[REDACTED_SECRET]";

export const redactRunEvent = <T>(event: T): T => {
  if (!isRecord(event)) {
    return event;
  }

  const redacted: Record<string, unknown> = { ...event };

  if (typeof event.message === "string") {
    redacted.message = redactLogText(event.message).text;
  }

  if (isRecord(event.metadata)) {
    redacted.metadata = redactMetadataValue(event.metadata, false, new WeakMap());
  }

  return redacted as T;
};

const redactMetadataValue = (
  value: unknown,
  forceSecretRedaction: boolean,
  seen: WeakMap<object, unknown>,
): unknown => {
  if (isScalarMetadataValue(value)) {
    if (forceSecretRedaction) {
      return SECRET_REDACTION;
    }

    return typeof value === "string" ? redactLogText(value).text : value;
  }

  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const redactedArray: unknown[] = [];
    seen.set(value, redactedArray);
    redactedArray.push(
      ...value.map((item) => redactMetadataValue(item, forceSecretRedaction, seen)),
    );

    return redactedArray;
  }

  if (isRecord(value)) {
    const existing = seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const redactedObject: Record<string, unknown> = {};
    seen.set(value, redactedObject);

    for (const [key, childValue] of Object.entries(value)) {
      redactedObject[key] = redactMetadataValue(
        childValue,
        forceSecretRedaction || isSecretLikeMetadataKey(key),
        seen,
      );
    }

    return redactedObject;
  }

  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isScalarMetadataValue = (value: unknown): boolean =>
  value === null || (typeof value !== "object" && typeof value !== "undefined");

const isSecretLikeMetadataKey = (key: string): boolean => {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();

  return (
    normalized === "token" ||
    normalized === "secret" ||
    normalized === "password" ||
    normalized === "passwd" ||
    normalized === "apikey" ||
    normalized === "accesstoken" ||
    normalized === "authtoken" ||
    normalized === "refreshtoken" ||
    normalized === "clientsecret" ||
    normalized === "privatekey" ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized.endsWith("passwd") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("privatekey")
  );
};
