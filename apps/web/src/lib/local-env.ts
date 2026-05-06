import { config as loadDotenv } from "dotenv";
import path from "node:path";

let loaded = false;

export function loadLocalEnv() {
  if (loaded || process.env.NODE_ENV === "production") {
    return;
  }

  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env")
  ];

  for (const candidate of candidates) {
    loadDotenv({ path: candidate, override: false, quiet: true });
  }

  loaded = true;
}
