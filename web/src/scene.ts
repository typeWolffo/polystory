import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type Mount = "turntable" | "socket" | "beside";

export type ViewerConfig = {
  mount: Mount;
  unitsPerMetre: number;
  rigUrl?: string;
  rigUnitsPerMetre?: number;
  rigClip?: string;
  rigClipAt?: number;
  socket?: string;
  /** In the recipe frame (+Z up, -Y forward), rig units. */
  offset?: [number, number, number];
  farMetres?: number;
  scaleFigure?: boolean;
  refUrl?: string;
  viewsRes?: Record<string, [number, number]>;
};

export type ViewPose = {
  target: [number, number, number];
  position: [number, number, number];
  lens: number;
  res: [number, number];
};

export type Pick = {
  point: [number, number, number];
  normal: [number, number, number];
  material: string;
  on: "model" | "reference";
};

export type Viewer = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls | null;
  model: THREE.Object3D;
  ref: THREE.Object3D | null;
  views: Record<string, ViewPose>;
  refViews: Record<string, ViewPose> | null;
  bounds: THREE.Box3;
  setView(name: string, subject?: "item" | "ref"): void;
  render(): void;
  screenshot(type?: string, quality?: number): string;
  pick(clientX: number, clientY: number): Pick | null;
  showRef(flag: boolean): void;
  setFigure(flag: boolean): void;
  setWireframe(flag: boolean): void;
  /** The model's own clips, by name. */
  clips: string[];
  /** Plays a clip on a loop, or with null stops and shows the rest pose. */
  play(name: string | null): void;
  pause(flag: boolean): void;
  clipState(): { name: string; time: number; paused: boolean } | null;
  /** Frames of a clip side by side, framed on the whole motion, as a PNG data URL. */
  clipStrip(name: string, frames?: number): string;
  reload(glbUrl: string): Promise<void>;
  resize(): void;
  dispose(): void;
};

export type CreateViewerOpts = {
  container: HTMLElement;
  glbUrl: string;
  config: ViewerConfig;
  interactive: boolean;
};

const DEFAULT_RES: Record<string, [number, number]> = {
  close: [900, 700],
  figure: [700, 900],
  far: [900, 640],
  front: [900, 700],
  quarter: [800, 800],
  top: [800, 800],
  scale: [800, 800],
};

const BACKGROUND = 0x141418;

const loader = new GLTFLoader();

function vec(v: THREE.Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

function extentOf(box: THREE.Box3): number {
  const s = new THREE.Vector3();
  box.getSize(s);

  return Math.max(s.x, s.y, s.z, 1e-3);
}

function centreOf(box: THREE.Box3): THREE.Vector3 {
  return box.getCenter(new THREE.Vector3());
}

/** Blender frames a 36 mm sensor to the larger image side. */
export function fovFor(lens: number, width: number, height: number): number {
  const across = 2 * Math.atan(18 / lens);

  if (height > width) return THREE.MathUtils.radToDeg(across);

  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(across / 2) * (height / width)));
}

function pose(target: THREE.Vector3, distance: number, yaw: number, pitch: number, lens: number, res: [number, number]): ViewPose {
  const y = THREE.MathUtils.degToRad(yaw);
  const p = THREE.MathUtils.degToRad(pitch);
  // glTF's +Z is the recipe's -Y, the front: yaw 0 looks at the face.
  const direction = new THREE.Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
  const position = target.clone().addScaledVector(direction, distance);

  return { target: vec(target), position: vec(position), lens, res };
}

function checkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#17171c";
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#212129";
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillRect(32, 32, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;

  return texture;
}

function addLights(scene: THREE.Scene, around: THREE.Vector3, radius: number): void {
  const r = Math.max(radius, 0.05);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a33, 1.2));
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xfff6e8, 1.7);
  key.position.copy(around).add(new THREE.Vector3(-2, 6.5, 3).multiplyScalar(r));
  key.target.position.copy(around);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = r * 0.1;
  key.shadow.camera.far = r * 20;
  const span = r * 3;
  key.shadow.camera.left = -span;
  key.shadow.camera.right = span;
  key.shadow.camera.top = span;
  key.shadow.camera.bottom = -span;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 4;
  key.shadow.intensity = 0.45;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xdde6ff, 0.8);
  fill.position.copy(around).add(new THREE.Vector3(3, 2.5, 2.5).multiplyScalar(r));
  fill.target.position.copy(around);
  scene.add(fill, fill.target);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  rim.position.copy(around).add(new THREE.Vector3(0, 3, -3).multiplyScalar(r));
  rim.target.position.copy(around);
  scene.add(rim, rim.target);
}

// The game plays a clip on the rig, so a frame of it is the pose people
// know; the bind pose (a T) is what the file shows otherwise.
function poseRig(rig: THREE.Object3D, clips: THREE.AnimationClip[], name: string | undefined, at: number): void {
  const clip = name ? clips.find((c) => c.name === name) : clips.find((c) => c.name === "idle");

  if (!clip) return;

  const mixer = new THREE.AnimationMixer(rig);
  mixer.clipAction(clip).play();
  mixer.setTime(Math.max(0, at) % Math.max(clip.duration, 1e-6));
  rig.updateMatrixWorld(true);
}

function prepareMeshes(root: THREE.Object3D): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}

function worldBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);

  return new THREE.Box3().setFromObject(object);
}

// Everywhere any clip takes the model, so the floor goes under the lowest
// point a wing beats down to and the camera frames the whole motion.
function motionBounds(object: THREE.Object3D, clips: THREE.AnimationClip[], samples = 12): THREE.Box3 {
  const box = worldBounds(object);

  if (clips.length === 0) return box;

  const mixer = new THREE.AnimationMixer(object);

  for (const clip of clips) {
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    for (let i = 0; i <= samples; i++) {
      action.reset();
      mixer.setTime((clip.duration * i) / samples);
      box.union(worldBounds(object));
    }

    action.stop();
  }

  mixer.uncacheRoot(object);
  object.updateWorldMatrix(true, true);

  return box;
}

export async function createViewer(opts: CreateViewerOpts): Promise<Viewer> {
  const { container, config, interactive } = opts;
  const units = config.unitsPerMetre;
  const rigUnits = config.rigUnitsPerMetre ?? units;
  const intoRig = rigUnits / units;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(interactive ? Math.min(window.devicePixelRatio, 2) : 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
  scene.add(camera);
  const controls = interactive ? new OrbitControls(camera, renderer.domElement) : null;

  if (controls) controls.enableDamping = true;

  let rig: THREE.Object3D | null = null;
  let socket: THREE.Object3D | null = null;

  if (config.mount !== "turntable") {
    if (!config.rigUrl || !config.socket) throw new Error(`mount ${config.mount} needs rigUrl and socket`);

    const gltf = await loader.loadAsync(config.rigUrl);
    rig = gltf.scene;
    prepareMeshes(rig);
    scene.add(rig);
    poseRig(rig, gltf.animations, config.rigClip, config.rigClipAt ?? 0);
    socket = rig.getObjectByName(config.socket) ?? null;

    if (!socket) throw new Error(`the rig has no node named ${JSON.stringify(config.socket)}`);
  }

  const stage = new THREE.Group();
  scene.add(stage);
  let model: THREE.Object3D = new THREE.Group();
  let ref: THREE.Object3D | null = null;
  let bounds = new THREE.Box3();
  // A render is of the rest pose and frames that; the page plays clips and
  // frames everywhere they go.
  let restBounds = new THREE.Box3();
  const framed = () => (interactive ? bounds : restBounds);
  let refBounds: THREE.Box3 | null = null;
  const rigBounds = rig ? worldBounds(rig) : null;
  const figure = new THREE.Group();
  figure.visible = Boolean(config.scaleFigure);
  scene.add(figure);
  let floor: THREE.Mesh | null = null;

  function mount(object: THREE.Object3D, clips: THREE.AnimationClip[] = []): void {
    prepareMeshes(object);

    if (config.mount === "socket" && socket) {
      socket.add(object);
      object.position.set(0, 0, 0);
      object.quaternion.identity();
      object.scale.setScalar(intoRig);
    } else if (config.mount === "beside" && socket) {
      const at = socket.getWorldPosition(new THREE.Vector3());
      const [ox, oy, oz] = config.offset ?? [-0.3, -0.2, 0.15];
      object.position.copy(at).add(new THREE.Vector3(ox, oz, -oy));
      object.scale.setScalar(intoRig);
      stage.add(object);
    } else {
      stage.add(object);
      object.position.y -= motionBounds(object, clips).min.y;
    }
  }

  function unmount(object: THREE.Object3D): void {
    object.parent?.remove(object);
  }

  async function load(url: string): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> {
    const gltf = await loader.loadAsync(url);
    mount(gltf.scene, gltf.animations);

    return gltf;
  }

  let clips: THREE.AnimationClip[] = [];
  let mixer: THREE.AnimationMixer | null = null;
  let action: THREE.AnimationAction | null = null;
  const clock = new THREE.Clock();
  const loaded = await load(opts.glbUrl);
  model = loaded.scene;
  clips = loaded.animations;
  restBounds = worldBounds(model);
  bounds = motionBounds(model, clips);

  if (config.refUrl) {
    ref = (await load(config.refUrl)).scene;
    refBounds = worldBounds(ref);
    ref.visible = false;
  }

  function buildFloor(): void {
    if (floor) {
      stage.remove(floor);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      floor = null;
    }

    if (config.mount !== "turntable") return;

    const union = bounds.clone();

    if (refBounds) union.union(refBounds);

    const extent = extentOf(union);
    const cell = 0.1 * units;
    const half = Math.max(extent * 4, cell * 10);
    const texture = checkerTexture();
    texture.repeat.set(half / cell, half / cell);
    floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centreOf(union).x, -0.0005 * units, centreOf(union).z);
    floor.receiveShadow = true;
    stage.add(floor);
  }

  function buildFigure(): void {
    figure.clear();

    if (config.mount !== "turntable") return;

    const height = 1.75 * units;
    const r = height * 0.11;
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, height - 2 * r, 8, 24), new THREE.MeshStandardMaterial({ color: 0x7a7a88, roughness: 0.85 }));
    const extent = extentOf(bounds);
    mesh.position.set(bounds.min.x - extent * 0.6 - 0.25 * units, height / 2, centreOf(bounds).z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    figure.add(mesh);
  }

  function resFor(name: string): [number, number] {
    return config.viewsRes?.[name] ?? DEFAULT_RES[name] ?? [800, 800];
  }

  function viewsFor(box: THREE.Box3): Record<string, ViewPose> {
    const centre = centreOf(box);
    const extent = extentOf(box);

    if (config.mount === "turntable") {
      const d = extent * 2.4;
      const out: Record<string, ViewPose> = {
        front: pose(centre, d, 0, 12, 50, resFor("front")),
        quarter: pose(centre, d, 40, 22, 50, resFor("quarter")),
        top: pose(centre, d, 20, 58, 50, resFor("top")),
      };

      if (config.scaleFigure && figure.children.length) {
        const both = box.clone().union(worldBounds(figure));
        out.scale = pose(centreOf(both), extentOf(both) * 1.6, 25, 10, 42, resFor("scale"));
      }

      return out;
    }

    const rigCentre = rigBounds ? centreOf(rigBounds) : centre;
    const rigHeight = rigBounds ? Math.max(rigBounds.max.y - rigBounds.min.y, 1e-3) : extent;
    const far = (config.farMetres ?? 7) * rigUnits;

    return {
      close: pose(centre, Math.max(extent * 2.6, rigHeight * 0.25), 30, 10, 50, resFor("close")),
      figure: pose(rigCentre, rigHeight * 1.35, 28, 8, 42, resFor("figure")),
      far: pose(rigCentre, far, 36, 12, 35, resFor("far")),
    };
  }

  const lightAround = rigBounds ? centreOf(rigBounds) : centreOf(bounds);
  const lightRadius = rigBounds ? (rigBounds.max.y - rigBounds.min.y) / 2 : extentOf(bounds);
  addLights(scene, lightAround, lightRadius);
  buildFloor();
  buildFigure();
  let views = viewsFor(framed());
  let refViews = refBounds ? viewsFor(refBounds) : null;

  function applyPose(view: ViewPose): void {
    const [w, h] = interactive ? [container.clientWidth || 1, container.clientHeight || 1] : view.res;
    camera.fov = fovFor(view.lens, w, h);
    camera.aspect = w / h;
    camera.position.set(...view.position);
    const target = new THREE.Vector3(...view.target);
    const distance = camera.position.distanceTo(target);
    camera.near = Math.max(distance * 0.01, 0.001);
    camera.far = distance * 50;
    camera.lookAt(target);
    camera.updateProjectionMatrix();

    if (controls) {
      controls.target.copy(target);
      controls.update();
    }
  }

  function setView(name: string, subject: "item" | "ref" = "item"): void {
    const source = subject === "ref" && refViews ? refViews : views;
    const view = source[name];

    if (!view) throw new Error(`no view ${JSON.stringify(name)}: ${Object.keys(source).join(", ")}`);

    if (!interactive) {
      renderer.setSize(view.res[0], view.res[1], false);
      // The figure is for the scale view; everywhere else it would crowd the item.
      figure.visible = name === "scale";
    }

    applyPose(view);
  }

  function resize(): void {
    if (!interactive) return;

    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render(): void {
    const dt = clock.getDelta();

    if (mixer && action && !action.paused) mixer.update(dt);

    controls?.update();
    renderer.render(scene, camera);
  }

  function play(name: string | null): void {
    mixer?.stopAllAction();
    action = null;

    if (name === null) return;

    const clip = clips.find((c) => c.name === name);

    if (!clip) throw new Error(`no clip ${JSON.stringify(name)}: ${clips.map((c) => c.name).join(", ") || "the model has none"}`);

    mixer ??= new THREE.AnimationMixer(model);
    action = mixer.clipAction(clip);
    action.reset().play();
    clock.getDelta();
  }

  function pause(flag: boolean): void {
    if (action) action.paused = flag;
  }

  function clipState(): { name: string; time: number; paused: boolean } | null {
    return action ? { name: action.getClip().name, time: action.time, paused: action.paused } : null;
  }

  function clipStrip(name: string, frames = 6): string {
    const clip = clips.find((c) => c.name === name);

    if (!clip) throw new Error(`no clip ${JSON.stringify(name)}`);

    const strip = new THREE.AnimationMixer(model);
    // Played once and held, so the last frame is the clip's end, not its start again.
    const once = strip.clipAction(clip);
    once.setLoop(THREE.LoopOnce, 1);
    once.clampWhenFinished = true;
    once.play();
    // A once-played action pauses at its end, and setTime() would not move it again.
    const poseAt = (t: number) => {
      once.reset();
      strip.setTime(t);
    };
    const times = Array.from({ length: frames }, (_, i) => (clip.duration * i) / Math.max(frames - 1, 1));
    const reach = new THREE.Box3();

    for (const t of times) {
      poseAt(t);
      reach.union(worldBounds(model));
    }

    const view = viewsFor(reach)[config.mount === "turntable" ? "quarter" : "close"];
    const [w, h] = [360, 360];
    const canvas = document.createElement("canvas");
    canvas.width = w * frames;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    renderer.setSize(w, h, false);
    applyPose({ ...view, res: [w, h] });
    ctx.font = "600 15px -apple-system, Segoe UI, sans-serif";

    times.forEach((t, i) => {
      poseAt(t);
      renderer.render(scene, camera);
      ctx.drawImage(renderer.domElement, i * w, 0, w, h);
      ctx.fillStyle = "rgba(20, 20, 24, 0.75)";
      ctx.fillRect(i * w + 8, 8, 112, 26);
      ctx.fillStyle = "#e8e8ee";
      ctx.fillText(`${name} ${t.toFixed(2)} s`, i * w + 16, 27);
    });

    // Stopping the last action on a binding puts the rest pose back.
    strip.stopAllAction();
    strip.uncacheRoot(model);

    return canvas.toDataURL("image/png");
  }

  function screenshot(type = "image/png", quality?: number): string {
    render();

    return renderer.domElement.toDataURL(type, quality);
  }

  const raycaster = new THREE.Raycaster();

  function pick(clientX: number, clientY: number): Pick | null {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // A raycast does not skip hidden objects: aim at whichever one is shown.
    const onRef = Boolean(ref?.visible);
    const hit = raycaster.intersectObject(onRef && ref ? ref : model, true)[0];

    if (!hit || !hit.face) return null;

    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const material = (hit.object as THREE.Mesh).material;
    const name = Array.isArray(material) ? (material[hit.face.materialIndex]?.name ?? "") : (material.name ?? "");

    return { point: vec(hit.point), normal: vec(normal), material: name, on: onRef ? "reference" : "model" };
  }

  function showRef(flag: boolean): void {
    if (!ref) return;

    ref.visible = flag;
    model.visible = !flag;
  }

  function setFigure(flag: boolean): void {
    figure.visible = flag;
    config.scaleFigure = flag;
    views = viewsFor(framed());
    refViews = refBounds ? viewsFor(refBounds) : null;
  }

  function setWireframe(flag: boolean): void {
    for (const root of [model, ref]) {
      root?.traverse((o) => {
        const mesh = o as THREE.Mesh;

        if (!mesh.isMesh) return;

        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          (m as THREE.MeshStandardMaterial).wireframe = flag;
        }
      });
    }
  }

  async function reload(glbUrl: string): Promise<void> {
    const next = await load(glbUrl);
    const playing = action?.getClip().name ?? null;
    mixer?.stopAllAction();
    mixer = null;
    action = null;
    unmount(model);
    model = next.scene;
    clips = next.animations;
    viewer.clips = clips.map((c) => c.name);
    model.visible = !(ref?.visible ?? false);
    restBounds = worldBounds(model);
    bounds = motionBounds(model, clips);

    if (playing && clips.some((c) => c.name === playing)) play(playing);

    buildFloor();
    buildFigure();
    views = viewsFor(framed());
    refViews = refBounds ? viewsFor(refBounds) : null;
    viewer.model = model;
    viewer.bounds = bounds;
    viewer.views = views;
  }

  function dispose(): void {
    controls?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  const viewer: Viewer = {
    renderer,
    scene,
    camera,
    controls,
    model,
    ref,
    views,
    refViews,
    bounds,
    setView,
    render,
    screenshot,
    pick,
    showRef,
    setFigure,
    setWireframe,
    clips: clips.map((c) => c.name),
    play,
    pause,
    clipState,
    clipStrip,
    reload,
    resize,
    dispose,
  };

  if (interactive) {
    resize();
    setView(Object.keys(views)[0]);
  }

  return viewer;
}
