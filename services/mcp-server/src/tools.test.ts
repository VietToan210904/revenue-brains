import { describe, expect, it } from "vitest";

import { toolDefinitions } from "./tools.js";

describe("Revenue Brains MCP tool definitions", () => {
  it("exposes controlled local MVP tools without raw database or shell tools", () => {
    const names = toolDefinitions.map((tool) => tool.name);

    expect(names).toContain("search_extracted_records");
    expect(names).toContain("get_document_metadata");
    expect(names).toContain("get_agent_run");
    expect(names).toContain("trigger_webhook_sync");
    expect(names).toContain("request_document_reprocess");
    expect(names).not.toContain("raw_sql");
    expect(names).not.toContain("shell");
    expect(names).not.toContain("read_raw_document");
  });

  it("marks read tools and safe write tools explicitly", () => {
    const triggerWebhook = toolDefinitions.find((tool) => tool.name === "trigger_webhook_sync");
    const searchRecords = toolDefinitions.find((tool) => tool.name === "search_extracted_records");

    expect(triggerWebhook?.readOnly).toBe(false);
    expect(searchRecords?.readOnly).toBe(true);
  });
});
