export const CHANGE_PACKAGE_SIGNATURE_ALGORITHM = "ECDSA-P256-SHA256";

type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

function getSubtleCrypto(): SubtleCrypto {
  if (typeof globalThis.crypto === "undefined" || !globalThis.crypto.subtle) {
    throw new Error("当前浏览器不支持修改包完整性校验。请使用新版 Chrome 或 Edge。");
  }

  return globalThis.crypto.subtle;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(buffer).set(bytes);

  return buffer;
}

function normalizeJson(value: unknown): JsonValue {
  if (value === null) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }

  if (typeof value === "object") {
    const normalized: { [key: string]: JsonValue } = {};

    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];

      if (typeof item !== "undefined") {
        normalized[key] = normalizeJson(item);
      }
    }

    return normalized;
  }

  return null;
}

function normalizeJwk(key: JsonWebKey | string): JsonWebKey {
  if (typeof key !== "string") {
    return key;
  }

  try {
    return JSON.parse(key) as JsonWebKey;
  } catch {
    throw new Error("成员签名密钥格式不正确。");
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export async function generateSigningKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
  keyId: string;
}> {
  const subtle = getSubtleCrypto();
  const keyPair = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await subtle.exportKey("jwk", keyPair.publicKey);
  const privateJwk = await subtle.exportKey("jwk", keyPair.privateKey);
  const publicKey = stableStringify(publicJwk);

  return {
    publicKey,
    privateKey: stableStringify(privateJwk),
    keyId: await createKeyId(publicKey),
  };
}

export async function createKeyId(publicKey: JsonWebKey | string): Promise<string> {
  const publicKeyText =
    typeof publicKey === "string" ? stableStringify(normalizeJwk(publicKey)) : stableStringify(publicKey);
  const hash = await sha256Hex(publicKeyText);

  return hash.replace("sha256:", "key_").slice(0, 20);
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await getSubtleCrypto().digest("SHA-256", bytes);

  return `sha256:${bytesToHex(new Uint8Array(hash))}`;
}

export function shortHash(hash?: string): string {
  if (!hash) {
    return "";
  }

  const digest = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;

  return digest.length > 12 ? `${digest.slice(0, 12)}...` : digest;
}

export async function signTextWithPrivateKey(
  privateKey: JsonWebKey | string,
  text: string,
): Promise<string> {
  const subtle = getSubtleCrypto();
  const key = await subtle.importKey(
    "jwk",
    normalizeJwk(privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(text),
  );

  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyTextSignature(
  publicKey: JsonWebKey | string,
  text: string,
  signature: string,
): Promise<boolean> {
  try {
    const subtle = getSubtleCrypto();
    const key = await subtle.importKey(
      "jwk",
      normalizeJwk(publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    return subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      bytesToArrayBuffer(base64ToBytes(signature)),
      new TextEncoder().encode(text),
    );
  } catch {
    return false;
  }
}
