import { mcpServerToken } from "./config.js";

export function isAuthorizedHeader(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  const token = mcpServerToken();

  return Boolean(header && token && header === `Bearer ${token}`);
}
