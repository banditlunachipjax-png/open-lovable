# Open Lovable MCP adapter

This is a separate MCP (Model Context Protocol) adapter for connecting selected Open Lovable capabilities to a compatible MCP client.

## What it currently does

- `open_lovable_scrape_website`: calls the configured Open Lovable instance's Firecrawl-backed scraping endpoint for a public website.
- `open_lovable_create_recreation_brief`: creates a structured prompt for rebuilding a website. It does **not** generate source code, create a sandbox, or deploy a site.

The adapter intentionally does not expose Open Lovable's shell/command, sandbox lifecycle, file-write, or code-execution routes. Those routes need per-user authentication and sandbox isolation before they can safely be exposed as remote tools.

## Configuration

Requirements: Node.js 20 or newer, an Open Lovable instance with its required Firecrawl configuration, and a compatible MCP client.

From this directory, install dependencies and set:

- `MCP_BEARER_TOKEN`: a random secret of at least 32 characters. Never commit it.
- `OPEN_LOVABLE_BASE_URL`: the base URL of your Open Lovable deployment. Use HTTPS in production.
- `PORT`: optional; defaults to `8787`.

Example environment (replace values locally; do not commit secrets):

```env
MCP_BEARER_TOKEN=replace_with_a_long_random_secret_at_least_32_chars
OPEN_LOVABLE_BASE_URL=https://your-open-lovable-host.example
PORT=8787
```

Run:

```sh
npm install
npm start
```

The MCP endpoint is `/mcp`; `/health` is a basic health check. Every MCP request must include `Authorization: Bearer <MCP_BEARER_TOKEN>`.

## Security notes

- Deploy only behind HTTPS.
- Keep this adapter's bearer token private. Rotate it if exposed.
- The adapter limits input sizes and rejects local, internal, and literal-IP URLs before scraping.
- The configured Open Lovable instance should not be exposed with unauthenticated sandbox or command APIs. Do not deploy this adapter as a substitute for securing the main app.
- Test only against websites you are authorized to inspect.
- MCP tools can expose untrusted page content to an AI model; treat scraped text as untrusted input.
- This is an initial integration scaffold, not a production security certification.

## ChatGPT connection

ChatGPT custom MCP connections require a compatible account/workspace and a reachable HTTPS MCP endpoint (or a supported secure tunnel). See the official OpenAI guide: https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt

This repository change does not itself install a new built-in ChatGPT tool. After deployment, add the endpoint in ChatGPT's custom MCP/plugin settings if that feature is available to your account.
