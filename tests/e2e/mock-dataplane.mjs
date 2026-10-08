// A stand-in for RudderStack, for the browser tests: it accepts events from both the browser SDK (one request per call
// to /v1/track, /v1/identify, /v1/group) and the Node SDK (/v1/batch), answers the browser SDK's request for the
// source's settings, and lets a test read back what it received. Nothing here talks to the real service.
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";

const port = Number(process.env.MOCK_DATAPLANE_PORT ?? 9411);
let received = [];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*, authorization, anonymousid, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};
const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }
  if (url.pathname === "/sourceConfig" || url.pathname === "/sourceConfig/") {
    return json(res, 200, {
      source: {
        id: "src-e2e",
        name: "e2e",
        writeKey: "e2e-write-key",
        enabled: true,
        workspaceId: "ws-e2e",
        updatedAt: new Date().toISOString(),
        config: { statsCollection: { errors: { enabled: false }, metrics: { enabled: false } } },
        destinations: [],
      },
    });
  }
  if (url.pathname === "/__received") {
    if (req.method === "DELETE") {
      received = [];
      return json(res, 200, { ok: true });
    }
    return json(res, 200, received);
  }
  if (req.method === "POST" && url.pathname.startsWith("/v1/")) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let raw = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "gzip") raw = gunzipSync(raw);
      try {
        const body = JSON.parse(raw.toString("utf8"));
        const msgs = Array.isArray(body.batch) ? body.batch : [body];
        for (const m of msgs)
          received.push({
            via: url.pathname === "/v1/batch" ? "server" : "browser",
            auth: req.headers.authorization ?? null,
            ...m,
          });
      } catch {
        /* a body that is not JSON is ignored, as the real service would reject it */
      }
      json(res, 200, { ok: true });
    });
    return;
  }
  json(res, 404, { error: "not found" });
}).listen(port, "127.0.0.1", () => console.log(`mock data plane on ${port}`));
