import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadLocalEnv } from "@/lib/local-env";

export type StoredUpload = {
  storageKey: string;
  checksum: string;
  sizeBytes: number;
  originalFilename: string;
  contentType: string;
};

const defaultUploadPath = "./uploads";

function getUploadRoot() {
  loadLocalEnv();

  const configuredPath = process.env.UPLOAD_STORAGE_PATH ?? defaultUploadPath;
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredPath);
}

function safeFilename(filename: string) {
  const parsed = path.parse(filename);
  const base = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const extension = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, "");

  return `${base || "document"}-${randomUUID()}${extension}`;
}

export async function storeChatAttachment(file: File): Promise<StoredUpload> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const storageKey = path.posix.join("documents", safeFilename(file.name));
  const destination = path.join(getUploadRoot(), ...storageKey.split("/"));

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);

  return {
    storageKey,
    checksum,
    sizeBytes: bytes.byteLength,
    originalFilename: file.name,
    contentType: file.type || "application/octet-stream"
  };
}
