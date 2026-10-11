import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

export type Mount = "turntable" | "socket" | "beside";

export type ViewerConfig = {
  mount: Mount;
  unitsPerMetre: number;
  rigUrl?: string;
  rigUnitsPerMetre?: number;
  rigClip?: string;
  rigClipAt?: number;
  socket?: string;
  offset?: [number, number, number];
  farMetres?: number;
  scaleFigure?: boolean;
  refUrl?: string;
  viewsRes?: Record<string, [number, number]>;
};

export type CheckResult = { status: "OK" | "WARN" | "FAIL"; summary: string; warnings: string[]; errors: string[] };

export type StatusPayload = {
  glb?: string;
  model: string;
  kind: string;
  recipe: string;
  iteration: number;
  check: CheckResult;
  mtime: number;
  style: { materials: Record<string, { hex: string }> };
};

export type ReviewPin = {
  id: number;
  point: [number, number, number];
  normal: [number, number, number];
  material: string;
  on?: "model" | "reference";
  camera: { position: [number, number, number]; target: [number, number, number] };
  text: string;
  screenshot?: string;
  screenshotPath?: string;
  state?: "open" | "check" | "resolved";
  iteration?: number;
  /** The clip and its time when the pin was dropped on a moving model. */
  clip?: { name: string; time: number };
};

export type ReviewPayload = {
  status: "changes" | "accepted" | "rejected" | "timeout";
  glb?: string;
  model?: string;
  iteration: number;
  tab?: "reused" | "opened" | "none";
  general: string;
  pins: ReviewPin[];
  file?: string;
};

export type ServerOpts = {
  webDir: string;
  threeDir: string;
  glbPath: string;
  refPath?: string;
  rigPath?: string;
  config: ViewerConfig;
  status: () => StatusPayload;
  onReview: (payload: ReviewPayload) => void;
  port?: number;
  host?: string;
};

export type RunningServer = { url: string; port: number; lastPollAt(): number; close(): Promise<void> };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".css": "text/css; charset=utf-8",
};

function sendFile(res: ServerResponse, path: string, root: string): void {
  const full = resolve(path);

  if (!full.startsWith(resolve(root) + sep) && full !== resolve(root)) return notFound(res);

  if (!existsSync(full) || !statSync(full).isFile()) return notFound(res);

  res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(full).pipe(res);
}

function sendJson(res: ServerResponse, body: unknown, code = 200): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function startServer(opts: ServerOpts): Promise<RunningServer> {
  const host = opts.host ?? "127.0.0.1";
  const config: ViewerConfig = { ...opts.config };

  if (opts.rigPath) config.rigUrl = "/rig.glb";

  if (opts.refPath) config.refUrl = "/ref.glb";

  const webDir = resolve(opts.webDir);
  const distDir = join(webDir, "dist");
  const threeBuild = join(resolve(opts.threeDir), "build");
  const threeAddons = join(resolve(opts.threeDir), "examples", "jsm");

  let lastPoll = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const path = normalize(decodeURIComponent(url.pathname));

    if (req.method === "POST" && path === "/review") {
      try {
        const payload = JSON.parse(await readBody(req)) as ReviewPayload;
        const current = opts.status();
        const mine = payload.glb ? payload.glb === current.glb : !payload.model || payload.model === current.model;

        // Every review shares the port, so a tab from another model may
        // still post here in the moment before it switches over.
        if (!mine) {
          sendJson(res, { ok: false, error: `this tab reviews ${payload.model ?? payload.glb}, the agent is reviewing ${current.model}` }, 409);

          return;
        }

        opts.onReview(payload);
        sendJson(res, { ok: true });
      } catch (error) {
        sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
      }

      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") return notFound(res);

    if (path === "/favicon.ico") {
      res.writeHead(204);
      res.end();

      return;
    }

    if (path === "/" || path === "/review.html") return sendFile(res, join(webDir, "review.html"), webDir);

    if (path === "/preview.html") return sendFile(res, join(webDir, "preview.html"), webDir);

    if (path.startsWith("/dist/")) return sendFile(res, join(distDir, path.slice("/dist/".length)), distDir);

    if (path === "/vendor/three/build/three.module.js") return sendFile(res, join(threeBuild, "three.module.js"), threeBuild);

    if (path.startsWith("/vendor/three/addons/")) return sendFile(res, join(threeAddons, path.slice("/vendor/three/addons/".length)), threeAddons);

    if (path === "/model.glb") return sendFile(res, opts.glbPath, opts.glbPath);

    if (path === "/ref.glb" && opts.refPath) return sendFile(res, opts.refPath, opts.refPath);

    if (path === "/rig.glb" && opts.rigPath) return sendFile(res, opts.rigPath, opts.rigPath);

    if (path === "/config") return sendJson(res, config);

    if (path === "/status") {
      lastPoll = Date.now();

      return sendJson(res, opts.status());
    }

    notFound(res);
  });

  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
      resolveServer({
        url: `http://${host}:${port}`,
        port,
        lastPollAt: () => lastPoll,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}
