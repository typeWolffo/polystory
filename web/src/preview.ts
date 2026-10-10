import { createViewer, type ViewerConfig } from "./scene.js";

type PreviewRequest = {
  glbUrl: string;
  refUrl?: string;
  config: ViewerConfig;
  views?: string[];
};

type Bridge = {
  shots: Record<string, string>;
  done: boolean;
  error: string | null;
};

const bridge: Bridge = { shots: {}, done: false, error: null };
(window as unknown as { __polystory: Bridge }).__polystory = bridge;

function readRequest(): PreviewRequest {
  const raw = new URLSearchParams(location.search).get("config");

  if (!raw) throw new Error("preview.html needs ?config=<base64url json>");

  const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));

  return JSON.parse(json) as PreviewRequest;
}

async function run(): Promise<void> {
  const request = readRequest();
  const config: ViewerConfig = { ...request.config, refUrl: request.refUrl };
  const viewer = await createViewer({ container: document.body, glbUrl: request.glbUrl, config, interactive: false });
  const wanted = request.views ?? Object.keys(viewer.views);

  for (const name of wanted) {
    viewer.setView(name, "item");
    bridge.shots[name] = viewer.screenshot("image/png");
  }

  if (viewer.ref && viewer.refViews) {
    viewer.showRef(true);

    for (const name of wanted) {
      if (!viewer.refViews[name]) continue;

      viewer.setView(name, "ref");
      bridge.shots[`ref_${name}`] = viewer.screenshot("image/png");
    }

    viewer.showRef(false);
  }

  bridge.done = true;
  document.title = "ready";
}

run().catch((error: unknown) => {
  bridge.error = error instanceof Error ? error.message : String(error);
  bridge.done = true;
  document.title = "error";
});
