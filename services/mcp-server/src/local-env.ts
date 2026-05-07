import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { config } from "dotenv";

export function loadLocalEnv() {
  if (process.env.APP_ENV === "production") {
    return;
  }

  let current = process.cwd();
  for (let index = 0; index < 5; index += 1) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) {
      config({ path: candidate, override: false });
      return;
    }

    const parent = dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}
