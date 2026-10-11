import * as THREE from "three";
import { createViewer, type Pick, type Viewer, type ViewerConfig } from "./scene.js";

type Status = {
  glb?: string;
  model: string;
  kind: string;
  recipe: string;
  iteration: number;
  check: { status: "OK" | "WARN" | "FAIL"; summary: string; warnings: string[]; errors: string[] };
  mtime: number;
  style: { materials: Record<string, { hex: string }> };
};

type Pin = Pick & {
  id: number;
  camera: { position: [number, number, number]; target: [number, number, number] };
  screenshot: string;
  text: string;
  iteration: number;
  state: "open" | "check" | "resolved";
  clip?: { name: string; time: number };
  dot: THREE.Mesh;
  label: HTMLDivElement;
  entry?: HTMLDivElement;
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const stage = $<HTMLElement>("stage");
const pins: Pin[] = [];
let viewer: Viewer;
let status: Status | null = null;
let lastMtime: number | null = null;
let openedFor: string | null = null;
let offline = false;

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) throw new Error(`${url}: ${response.status}`);

  return (await response.json()) as T;
}

function toast(text: string): void {
  const el = $("toast");
  el.textContent = text;
  el.style.display = "block";
  setTimeout(() => {
    el.style.display = "none";
  }, 3500);
}

function applyStatus(next: Status): void {
  status = next;
  $("meta").innerHTML = `${next.kind} / <code>${next.model}</code> · recipe <code>${next.recipe}</code>`;
  const check = $("check");
  check.textContent = `check ${next.check.status}`;
  check.className = `chip ${next.check.status.toLowerCase()}`;
  check.title = [...next.check.warnings, ...next.check.errors].join("\n");
  $("stats").textContent = next.check.summary;
  $("iteration").textContent = `iteration ${next.iteration}`;
  const palette = $("palette");
  palette.innerHTML = "";

  for (const [name, spec] of Object.entries(next.style.materials)) {
    const sw = document.createElement("div");
    sw.className = "sw";
    sw.style.background = spec.hex;
    sw.title = `${name} ${spec.hex}`;
    palette.appendChild(sw);
  }

  $("accept").textContent = `Accept ${next.model}`;
}

function setOffline(flag: boolean): void {
  if (flag === offline) return;

  offline = flag;
  $("building").classList.toggle("hidden", !flag);
}

function renderViewButtons(): void {
  const views = $("views");
  views.innerHTML = "";

  for (const name of Object.keys(viewer.views)) {
    const button = document.createElement("button");
    button.textContent = name === "far" ? `from ${status ? "the game's distance" : "far"}` : name;
    button.addEventListener("click", () => viewer.setView(name));
    views.appendChild(button);
  }
}

// A clip button plays its clip on a loop and pauses it on a second click;
// "rest" stops and shows the pose the file was modelled in.
function renderClipButtons(): void {
  const bar = $("clips");
  bar.innerHTML = "";

  if (viewer.clips.length === 0) return;

  const state = viewer.clipState();
  const names: (string | null)[] = [null, ...viewer.clips];

  for (const name of names) {
    const button = document.createElement("button");
    const active = name !== null && state?.name === name;
    button.textContent = name === null ? "rest" : `${active && !state?.paused ? "❚❚" : "▶"} ${name}`;
    button.classList.toggle("on", name === null ? !state : active);
    button.addEventListener("click", () => {
      if (active) viewer.pause(!state!.paused);
      else viewer.play(name);

      renderClipButtons();
    });
    bar.appendChild(button);
  }
}

function renderList(): void {
  const list = $("pins");
  list.innerHTML = pins.length ? "" : '<div class="empty">Click the model where something is off.</div>';

  for (const pin of pins) {
    const el = document.createElement("div");
    el.className = `pin ${pin.state}`;
    pin.entry = el;
    const resolve = pin.state === "open" ? "" : `<label><input type="checkbox" ${pin.state === "resolved" ? "checked" : ""}> resolved</label>`;
    const moment = pin.clip ? ` · at <b>${pin.clip.name}</b> ${pin.clip.time.toFixed(2)} s` : "";
    el.innerHTML = `<div class="n">${pin.id}</div><div><textarea placeholder="What is wrong here?"></textarea><div class="where">on <b>${pin.material || "mesh"}</b>${pin.on === "reference" ? " of the <b>reference</b>" : ""}${moment} · from iteration ${pin.iteration} · camera and screenshot saved ${resolve}</div></div><button class="x" title="remove">×</button>`;
    const textarea = el.querySelector("textarea")!;
    textarea.value = pin.text;
    textarea.addEventListener("input", () => {
      pin.text = textarea.value;
    });
    el.querySelector<HTMLInputElement>("input[type=checkbox]")?.addEventListener("change", (event) => {
      pin.state = (event.target as HTMLInputElement).checked ? "resolved" : "check";
      el.className = `pin ${pin.state}`;
      pin.label.className = `label ${pin.state}`;
    });
    el.querySelector(".x")!.addEventListener("click", () => {
      viewer.scene.remove(pin.dot);
      pin.label.remove();
      pins.splice(pins.indexOf(pin), 1);
      pins.forEach((p, i) => {
        p.id = i + 1;
      });
      renderList();
    });
    list.appendChild(el);
  }

  updateSend();
}

// The note in "General" goes with every send, so the button counts it: a
// note alone is a valid round, an empty page is not.
function sendWhat(): string | null {
  const note = $<HTMLTextAreaElement>("general").value.trim().length > 0;
  const n = pins.length;
  const pinsText = n === 0 ? "" : `${n} pin${n === 1 ? "" : "s"}`;

  if (!pinsText && !note) return null;

  return [pinsText, note ? "the note" : ""].filter(Boolean).join(" and ");
}

function updateSend(): void {
  const what = sendWhat();
  const button = $<HTMLButtonElement>("send");
  button.textContent = what ? `Send ${what} to the agent` : "Send to the agent";
  button.disabled = what === null;
}

function addPin(hit: Pick): void {
  // A pin on a moving part would be left behind: the clip holds still under it.
  const playing = viewer.clipState();

  if (playing && !playing.paused) {
    viewer.pause(true);
    renderClipButtons();
  }

  const extent = new THREE.Vector3();
  viewer.bounds.getSize(extent);
  const radius = Math.max(extent.x, extent.y, extent.z) * 0.015;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3d7f }));
  dot.position.set(...hit.point).addScaledVector(new THREE.Vector3(...hit.normal), radius * 0.3);
  viewer.scene.add(dot);
  const label = document.createElement("div");
  label.className = "label";
  stage.appendChild(label);
  const target = viewer.controls ? viewer.controls.target.toArray() as [number, number, number] : [0, 0, 0] as [number, number, number];
  const pin: Pin = {
    ...hit,
    id: pins.length + 1,
    camera: { position: viewer.camera.position.toArray() as [number, number, number], target },
    screenshot: viewer.screenshot("image/jpeg", 0.7),
    text: "",
    iteration: status?.iteration ?? 0,
    state: "open",
    clip: playing ? { name: playing.name, time: playing.time } : undefined,
    dot,
    label,
  };
  pins.push(pin);
  renderList();
  pin.entry?.querySelector("textarea")?.focus();
}

function wirePointer(): void {
  let downAt: [number, number] | null = null;
  const canvas = viewer.renderer.domElement;
  canvas.addEventListener("pointerdown", (event) => {
    downAt = [event.clientX, event.clientY];
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!downAt) return;

    const moved = Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]);
    downAt = null;

    if (moved > 4) return;

    const hit = viewer.pick(event.clientX, event.clientY);

    if (hit) addPin(hit);
  });
}

function wireTools(config: ViewerConfig): void {
  let wire = false;
  let figure = Boolean(config.scaleFigure);
  let ref = false;
  const wireButton = $("wire");
  const figureButton = $("figure");
  const refButton = $("ref");
  figureButton.classList.toggle("on", figure);
  figureButton.classList.toggle("hidden", config.mount !== "turntable");
  wireButton.addEventListener("click", () => {
    wire = !wire;
    viewer.setWireframe(wire);
    wireButton.classList.toggle("on", wire);
  });
  figureButton.addEventListener("click", () => {
    figure = !figure;
    viewer.setFigure(figure);
    figureButton.classList.toggle("on", figure);
  });

  if (viewer.ref) {
    refButton.classList.remove("hidden");
    refButton.addEventListener("click", () => {
      ref = !ref;
      viewer.showRef(ref);
      refButton.classList.toggle("on", ref);
      refButton.textContent = ref ? "show model" : "show reference";
    });
  }
}

const identity = (s: Status): string => s.glb ?? s.model;

function payload(result: "changes" | "accepted" | "rejected") {
  return {
    status: result,
    glb: status?.glb,
    model: status?.model,
    iteration: status?.iteration ?? 0,
    general: $<HTMLTextAreaElement>("general").value,
    pins: pins.map(({ id, point, normal, material, on, camera, text, screenshot, state, iteration, clip }) => ({ id, point, normal, material, on, camera, text, screenshot, state, iteration, clip })),
  };
}

async function post(result: "changes" | "accepted" | "rejected", message: string): Promise<void> {
  try {
    const response = await fetch("/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(result)) });

    if (response.status === 409) {
      toast("the agent moved on to another model: this page reloads to it");
      setTimeout(() => location.reload(), 1200);

      return;
    }

    if (!response.ok) throw new Error(String(response.status));

    toast(message);
  } catch {
    toast("could not reach the agent: is `polystory review` still running?");
  }
}

function wireFooter(): void {
  $("general").addEventListener("input", updateSend);
  $("send").addEventListener("click", () => {
    const what = sendWhat();

    if (what) void post("changes", `sent ${what} to the agent · waiting for the next build`);
  });
  $("accept").addEventListener("click", () => post("accepted", "accepted · keep this tab open: the next model loads here"));
  $("reject").addEventListener("click", () => post("rejected", "sent: start over"));
}

async function poll(): Promise<void> {
  try {
    const next = await json<Status>("/status");
    setOffline(false);

    // One tab, always the current review: when the agent moves on to
    // another model, the page starts over on it instead of going stale.
    if (openedFor && identity(next) !== openedFor) {
      location.reload();

      return;
    }

    if (lastMtime !== null && next.mtime !== lastMtime) {
      await viewer.reload(`/model.glb?t=${next.mtime}`);

      for (const pin of pins) {
        if (pin.state === "open") {
          pin.state = "check";
          pin.label.className = "label check";
        }
      }

      renderList();
      renderViewButtons();
      renderClipButtons();
      toast(`iteration ${next.iteration} loaded · pins from before are marked "to check"`);
    }

    lastMtime = next.mtime;
    applyStatus(next);
  } catch {
    setOffline(true);
  }
}

function loop(): void {
  requestAnimationFrame(loop);
  viewer.render();
  const tmp = new THREE.Vector3();
  const w = stage.clientWidth;
  const h = stage.clientHeight;

  for (const pin of pins) {
    tmp.copy(pin.dot.position).project(viewer.camera);
    pin.label.style.left = `${((tmp.x + 1) / 2) * w}px`;
    pin.label.style.top = `${((1 - tmp.y) / 2) * h}px`;
    pin.label.textContent = String(pin.id);
    pin.label.style.display = tmp.z < 1 ? "flex" : "none";
  }
}

async function main(): Promise<void> {
  const config = await json<ViewerConfig>("/config");
  const first = await json<Status>("/status");
  openedFor = identity(first);
  document.title = `polystory review · ${first.model}`;
  lastMtime = first.mtime;
  applyStatus(first);
  viewer = await createViewer({ container: stage, glbUrl: `/model.glb?t=${first.mtime}`, config, interactive: true });
  renderViewButtons();

  if (viewer.clips.length) viewer.play(viewer.clips[0]);

  renderClipButtons();
  wirePointer();
  wireTools(config);
  wireFooter();
  addEventListener("resize", () => viewer.resize());
  setInterval(poll, 1000);
  loop();
}

main().catch((error: unknown) => {
  $("meta").textContent = error instanceof Error ? error.message : String(error);
});
