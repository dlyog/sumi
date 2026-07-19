# Integration assets

- `custom-gpt-openapi.json` imports into a Custom GPT Action after replacing its
  placeholder HTTPS server URL.
- `app/mcp_server.py` is the ChatGPT App MCP server and embedded widget resource.

Run the complete local stack with `make demo`, or MCP alone with `make mcp`.
ChatGPT requires an HTTPS route to `/mcp`; see `docs/CHATGPT_MCP.md` for setup and
security boundaries.
