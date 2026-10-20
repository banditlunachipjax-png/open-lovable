import express from "express";
import { isIP } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 8787);
const MCP_TOKEN = process.env.MCP_BEARER_TOKEN;
const OPEN_LOVABLE_BASE_URL = process.env.OPEN_LOVABLE_BASE_URL;
const MAX_URL_LENGTH = 2048;

if (!MCP_TOKEN || MCP_TOKEN.length < 32) {
  console.error("MCP_BEARER_TOKEN is required and must be at least 32 characters.");
  process.exit(1);
}
if (!OPEN_LOVABLE_BASE_URL) {
  console.error("OPEN_LOVABLE_BASE_URL is required.");
  process.exit(1);
}

const base = new URL(OPEN_LOVABLE_BASE_URL);
if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) {
  console.error("OPEN_LOVABLE_BASE_URL must use HTTPS except for local development.");
  process.exit(1);
}
if (base.username || base.password || base.search || base.hash) {
  console.error("OPEN_LOVABLE_BASE_URL must not contain credentials, query parameters, or a fragment.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

function constantTimeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function authorized(req) {
  const header = req.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return Boolean(match && constantTimeEqual(match[1], MCP_TOKEN));
}

function validatePublicWebsite(raw) {
  if (typeof raw !== "string" || raw.length > MAX_URL_LENGTH) {
    throw new Error("Provide a valid website URL (maximum 2048 characters).");
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP and HTTPS website URLs are supported.");
  }
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".test") ||
    isIP(host) !== 0
  ) {
    throw new Error("Local, internal, and literal-IP addresses are not allowed. Enter a public website domain.");
  }
  return url.toString();
}

function createMcpServer() {
  const server = new McpServer({
    name: "open-lovable",
    version: "0.1.0"
  });

  server.registerTool(
    "open_lovable_scrape_website",
    {
      title: "Scrape a public website",
      description: "Use Open Lovable's configured Firecrawl integration to retrieve the main content and metadata of a public website. Does not create or deploy a site.",
      inputSchema: {
        url: z.string().url().max(MAX_URL_LENGTH).describe("Public website URL to inspect")
      }
    },
    async ({ url }) => {
      const safeUrl = validatePublicWebsite(url);
      const endpoint = new URL("/api/scrape-url-enhanced", base);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: safeUrl }),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.success === false) {
          throw new Error(payload.error || `Open Lovable returned HTTP ${response.status}`);
        }
        const structured = payload.structured || payload.data || payload;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              url: safeUrl,
              title: structured.title || payload.metadata?.title || "",
              description: structured.description || payload.metadata?.description || "",
              content: String(structured.content || structured.markdown || payload.content || "").slice(0, 30000),
              screenshot: structured.screenshot || payload.screenshot || null,
              note: "This tool inspects a website. It does not generate, save, or deploy a replacement site."
            }, null, 2)
          }]
        };
      } catch (error) {
        const message = error?.name === "AbortError" ? "Website inspection timed out." : (error?.message || "Website inspection failed.");
        return { isError: true, content: [{ type: "text", text: message }] };
      } finally {
        clearTimeout(timeout);
      }
    }
  );

  server.registerTool(
    "open_lovable_create_recreation_brief",
    {
      title: "Create a website recreation brief",
      description: "Create a structured prompt for recreating a website from a public URL. Use the scrape tool first when possible. This produces a brief only; it does not run code or deploy a website.",
      inputSchema: {
        url: z.string().url().max(MAX_URL_LENGTH).describe("Public website URL to recreate"),
        goal: z.string().trim().min(5).max(2000).describe("What the recreated site should do and any changes to make"),
        framework: z.enum(["React", "Next.js", "plain HTML/CSS/JS"]).default("React")
      }
    },
    async ({ url, goal, framework }) => {
      const safeUrl = validatePublicWebsite(url);
      const brief = [
        "Build a polished, responsive website inspired by the public reference below.",
        `Reference URL: ${safeUrl}`,
        `Target framework: ${framework}`,
        `User goals: ${goal}`,
        "First inspect the reference's visual hierarchy, navigation, typography, spacing, colors, responsive behavior, and core user journey.",
        "Create original implementation code and original copy; do not copy private assets, credentials, or copyrighted text wholesale.",
        "Make all buttons and forms functional, include accessible labels and keyboard focus states, and test mobile and desktop layouts.",
        "If the reference could not be inspected, state assumptions instead of inventing details.",
        "Return the proposed file tree, implementation, run instructions, and any missing inputs."
      ].join("\n\n");
      return { content: [{ type: "text", text: brief }] };
    }
  );

  return server;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "open-lovable-mcp", mcpPath: "/mcp" });
});

app.all("/mcp", async (req, res) => {
  if (!authorized(req)) {
    res.set("WWW-Authenticate", "Bearer");
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "This stateless MCP endpoint accepts POST requests only." });
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error?.message || error);
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed." });
  }
});

app.listen(PORT, () => {
  console.log(`Open Lovable MCP listening on port ${PORT}`);
});
