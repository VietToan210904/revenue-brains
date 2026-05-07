from app.tools import mcp_tools


def test_mcp_client_disabled_by_default(monkeypatch):
    monkeypatch.delenv("MCP_CLIENT_ENABLED", raising=False)

    assert mcp_tools.get_mcp_postgres_evidence("workspace_123", "invoice due date") == []


def test_mcp_evidence_uses_structured_records(monkeypatch):
    monkeypatch.setenv("MCP_CLIENT_ENABLED", "true")

    def fake_call_mcp_tool(tool_name, arguments):
        assert tool_name == "search_extracted_records"
        assert arguments["workspaceId"] == "workspace_123"
        assert arguments["query"] == "invoice due date"
        return {
            "records": [
                {
                    "id": "record_123",
                    "title": "Invoice INV-1001",
                }
            ]
        }

    monkeypatch.setattr(mcp_tools, "call_mcp_tool", fake_call_mcp_tool)

    evidence = mcp_tools.get_mcp_postgres_evidence("workspace_123", "invoice due date")

    assert evidence == [
        {
            "source": "mcp",
            "tool": "search_extracted_records",
            "id": "record_123",
            "title": "Invoice INV-1001",
        }
    ]


def test_mcp_evidence_ignores_unavailable_server(monkeypatch):
    monkeypatch.setenv("MCP_CLIENT_ENABLED", "true")
    monkeypatch.setattr(mcp_tools, "call_mcp_tool", lambda _tool_name, _arguments: None)

    assert mcp_tools.get_mcp_postgres_evidence("workspace_123", "anything") == []
