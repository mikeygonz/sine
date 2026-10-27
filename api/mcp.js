// "Connect your agent": an MCP server (Streamable HTTP, stateless, JSON responses) at /api/mcp.
// The visitor's own agent does the thinking on its own model and credits; Sine only cleans up
// the line and returns a link that plays it. No AI Gateway calls, no storage, no sessions.
// Small enough to speak the protocol directly, so the repo stays free of dependencies.
import { MAX_IN, pathPoints, readPoints, shape, pack } from "./_shape.js";

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const PRESETS = ["star", "heart", "square"];
const MAX_BODY = 200_000;

const INSTRUCTIONS = `Sine redraws any closed line with spinning circles (a Fourier series). Draw by sending one continuous line to draw_shape, then give the user the link it returns. The page plays the drawing.`;

const TOOLS = [
  {
    name: "draw_shape",
    title: "Draw a shape",
    description: `Draw one continuous line and get a link where spinning circles redraw it.
Send either points or an SVG path. y points down. Any scale works; Sine fits it to its canvas.
The line is closed automatically, and separate parts get joined by straight pen moves, so draw it the way a pen would in one unbroken stroke: go around the outline and pass into inner details where the line is already close, retracing a stretch rather than jumping.
Get proportions right first; a few telling details matter more than many. Up to ${MAX_IN} points.`,
    inputSchema: {
      type: "object",
      properties: {
        points: {
          type: "array",
          description: "The line as ordered [x, y] pairs.",
          items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          maxItems: MAX_IN,
        },
        path: { type: "string", description: "An SVG path d string (M L H V C S Q T A Z), used instead of points." },
        smooth: {
          type: "boolean",
          description: "Join sparse points with a smooth curve instead of straight segments. Default false.",
        },
        name: { type: "string", description: "A short name for the drawing, like 'Cat'.", maxLength: 40 },
        waves: {
          type: "integer",
          description: "How many circles to start with, 1 to 1000. Default 255. Fewer looks rounder and looser.",
          minimum: 1,
          maximum: 1000,
        },
      },
    },
    outputSchema: {
      type: "object",
      properties: { url: { type: "string" }, points: { type: "integer" } },
      required: ["url", "points"],
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_presets",
    title: "List presets",
    description: "The built-in shapes, each with a link that plays it.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];

const BASE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128, 255, 512, 1000];

function drawShape(args, origin) {
  const { points, path, smooth, name, waves } = args || {};
  if (points != null && path != null) throw new Error("send points or path, not both");
  if (points == null && path == null) throw new Error("send points or path");
  if (points != null && (!Array.isArray(points) || points.length > MAX_IN))
    throw new Error(`points must be a list of up to ${MAX_IN} [x, y] pairs`);
  if (path != null && (typeof path !== "string" || path.length > 50_000)) throw new Error("path is too long");
  const raw = points != null ? readPoints(points) : pathPoints(path);
  const pts = shape(raw, { smooth: !!smooth });
  const q = new URLSearchParams({ s: pack(pts) });
  const title = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
  if (title) q.set("t", title);
  if (waves != null) {
    const w = Math.round(+waves);
    if (!(w >= 1 && w <= 1000)) throw new Error("waves must be 1 to 1000");
    // the page's slider has fixed steps; snap to the nearest
    q.set("n", String(BASE.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a))));
  }
  const url = `${origin}/?${q}`;
  return {
    content: [{ type: "text", text: `Open ${url} to watch ${title || "it"} drawn by spinning circles.` }],
    structuredContent: { url, points: pts.length },
  };
}

function listPresets(origin) {
  const presets = PRESETS.map((p) => ({ name: p, url: `${origin}/?p=${p}` }));
  return {
    content: [{ type: "text", text: presets.map((p) => `${p.name}: ${p.url}`).join("\n") }],
    structuredContent: { presets },
  };
}

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

function handle(msg, origin) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    // a response from the client, or junk; responses need no answer
    return msg && "id" in msg && !("result" in msg || "error" in msg)
      ? fail(msg.id ?? null, -32600, "invalid request")
      : null;
  }
  const { id, method, params } = msg;
  if (!("id" in msg)) return null; // notification, e.g. notifications/initialized
  switch (method) {
    case "initialize": {
      const want = params?.protocolVersion;
      return ok(id, {
        protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "sine", title: "Sine", version: "0.1.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: TOOLS });
    case "tools/call": {
      const name = params?.name;
      try {
        if (name === "draw_shape") return ok(id, drawShape(params.arguments, origin));
        if (name === "list_presets") return ok(id, listPresets(origin));
      } catch (e) {
        // tool errors go back to the model so it can fix its input
        return ok(id, { content: [{ type: "text", text: String(e.message || e) }], isError: true });
      }
      return fail(id, -32602, `unknown tool ${name}`);
    }
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers":
    "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
};
const reply = (body, status = 200) =>
  new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { ...CORS, "cache-control": "no-store", ...(body == null ? {} : { "content-type": "application/json" }) },
  });

export async function POST(request) {
  const origin = new URL(request.url).origin;
  let text = "";
  try {
    text = await request.text();
  } catch {}
  if (text.length > MAX_BODY) return reply(fail(null, -32600, "request too large"), 413);
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return reply(fail(null, -32700, "parse error"), 400);
  }
  if (Array.isArray(msg)) {
    const out = msg.map((m) => handle(m, origin)).filter(Boolean);
    return out.length ? reply(out) : reply(null, 202);
  }
  const out = handle(msg, origin);
  return out ? reply(out) : reply(null, 202);
}

// No server-to-client stream and no sessions in this stateless server.
export const GET = () => new Response(null, { status: 405, headers: { ...CORS, allow: "POST" } });
export const DELETE = GET;
export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });
