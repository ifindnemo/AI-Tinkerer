"use client";

import { useEffect, useRef, useState } from "react";
import {thermalLevel, thermalLabels} from "@/lib/thermal-status";
import type { Analysis, Telemetry } from "@/lib/telemetry";
import type { Vehicle } from "@/lib/vehicles";
import { useLang } from "@/hooks/use-preferences";
import { pick } from "@/lib/preferences";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  Expand,
  RotateCcw,
  Rotate3D,
  ScanLine,
  LoaderCircle,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Pause,
  Play,
} from "lucide-react";

export default function CarViewer({
  vehicle,
  color,
  scanning,
  telemetry,
  analysis,
  source = "simulated",
}: {
  vehicle: Vehicle;
  color: string;
  scanning: boolean;
  telemetry: Telemetry;
  analysis: Analysis | null;
  // "obd": live data from the car (device mode); labels must not say "simulated".
  source?: "simulated" | "obd";
}) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const tags = useRef<Record<string, HTMLButtonElement | null>>({});
  const api = useRef<{
    reset: () => void;
    view: (name: string) => void;
    zoom: (factor: number) => void;
    rotate: (value: boolean) => void;
    paint: (color: string) => void;
  } | null>(null);
  const {t, lang} = useLang();
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  // Error codes are set inside the WebGL effect and translated at render time.
  const [error, setError] = useState<"" | "webgl" | "load" | "context" | "fullscreen">("");
  const [retry, setRetry] = useState(0);
  const [rotating, setRotating] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const motion = useRef({enabled: true, connected: false, speed: 0});
  useEffect(() => {
    motion.current = {enabled: motionEnabled, connected: telemetry.connected, speed: telemetry.speed};
  }, [motionEnabled, telemetry.connected, telemetry.speed]);
  const [markers, setMarkers] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);
  const [view, setView] = useState("perspective");
  const report = telemetry.connected && !scanning ? analysis : null;
  const status = scanning ? "scanning" : report?.severity ?? "unknown";
  const hot = thermalLevel(telemetry,"engine") === "danger" || thermalLevel(telemetry,"cooling") === "danger";
  const initialColor = useRef(color);
  const obd = source === "obd";
  // Device mode leaves unsupported sensors as NaN; never print "NaN°C".
  const degrees = (value: number) => Number.isFinite(value) ? `${value}°C` : "—";

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let frame = 0;
    let needsRender = true;
    let lastFrame = 0;
    let framing = 1;
    let model: THREE.Object3D | undefined;
    const wheels: THREE.Group[] = [];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visualSpeed = 0;
    let distance = 0;
    const scene = new THREE.Scene();
    // Local geometry only. Road travel is illustrative: workbook speed units are uncalibrated.
    const road = new THREE.Group();
    const roadMaterial = new THREE.MeshBasicMaterial({color: 0x9aafa5, transparent: true, opacity: 0.4});
    const dashGeometry = new THREE.PlaneGeometry(0.035, 0.65);
    for (const x of [-1.3, 1.3]) {
      for (let i = 0; i < 12; i++) {
        const dash = new THREE.Mesh(dashGeometry, roadMaterial);
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(x, 0.008, i * 1.2 - 7.2);
        road.add(dash);
      }
    }
    road.visible = false;
    scene.add(road);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      queueMicrotask(() =>
        setError("webgl"),
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-label", `${vehicle.brand} ${vehicle.name} 3D`); // the sentence follows the language: see the effect below
    renderer.domElement.setAttribute("role", "img");
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 3.6;
    controls.maxDistance = 12;
    controls.minPolarAngle = 0.01;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.autoRotateSpeed = 0.6;
    controls.addEventListener("change", () => {
      needsRender = true;
    });
    const viewpoints: Record<string, [number, number, number]> = {
      perspective: [3.3, 1.65, 3.5], front: [0, 1.1, 5.6],
      rear: [0, 1.1, -5.6], side: [6.8, 1.2, 0], top: [0, 7.8, 0.01],
    };
    const changeView = (name: string) => {
      controls.autoRotate = false;
      controls.target.set(0, 0.55, 0);
      camera.position.fromArray(viewpoints[name] ?? viewpoints.perspective)
        .sub(controls.target).multiplyScalar(framing).add(controls.target);
      controls.update();
      needsRender = true;
    };
    controls.addEventListener("start", () => setView("custom"));
    const reset = () => {
      controls.target.set(0, 0.55, 0);
      camera.position
        .set(3.3, 1.65, 3.5)
        .sub(controls.target)
        .multiplyScalar(framing)
        .add(controls.target);
      controls.update();
    };
    reset();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04);
    scene.environment = env.texture;
    room.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb4bcb6, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(3, 7, 5);
    scene.add(sun);
    // A soft contact shadow built locally; no external HDR or texture request.
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const context = shadowCanvas.getContext("2d")!;
    const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 64);
    gradient.addColorStop(0, "rgba(21,37,30,0.4)");
    gradient.addColorStop(0.55, "rgba(21,37,30,0.18)");
    gradient.addColorStop(1, "rgba(21,37,30,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 6.9),
      new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.006;
    scene.add(shadow);
    const paintMaterials: THREE.MeshStandardMaterial[] = [];
    const replacedTextures = new Set<THREE.Texture>();
    const paint = (hex: string) => {
      paintMaterials.forEach((m) => m.color.set(hex));
      needsRender = true;
    };
    const disposeModel = (obj: THREE.Object3D) => {
      const textures = new Set<THREE.Texture>();
      const materials = new Set<THREE.Material>();
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(
            (m: THREE.Material) => {
              materials.add(m);
              Object.values(m).forEach((v) => {
                if (v instanceof THREE.Texture) textures.add(v);
              });
            },
          );
        }
      });
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    };
    new GLTFLoader().load(
      vehicle.model.url,
      (gltf) => {
        if (disposed) {
          disposeModel(gltf.scene);
          return;
        }
        model = gltf.scene;
        let bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const scale = 4.5 / Math.max(size.x, size.z);
        model.scale.multiplyScalar(scale);
        if (size.x > size.z) model.rotation.y += Math.PI / 2;
        model.updateMatrixWorld(true);
        bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        model.position.add(
          new THREE.Vector3(-center.x, -bounds.min.y + 0.025, -center.z),
        );
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m: THREE.MeshStandardMaterial) => {
              if (/Paint_Material/i.test(m.name)) {
                if (m.map) replacedTextures.add(m.map);
                m.map = null;
                m.metalness = 0.75;
                m.roughness = 0.23;
                paintMaterials.push(m);
              }
            });
          }
        });
        // The source separates every wheel spoke into its own mesh. Batch opaque
        // parts by material to avoid over a thousand draw calls per frame.
        model.updateMatrixWorld(true);
        const batches = new Map<
          string,
          { geometries: THREE.BufferGeometry[]; material: THREE.Material; target: THREE.Group }
        >();
        const baked = new THREE.Group();
        const wheelTargets = new Map<THREE.Object3D, THREE.Group>();
        model.traverse((object) => {
          if (!/^3DWheel[ _](Front|Rear)[ _][LR]/i.test(object.name)) return;
          const pivot = new THREE.Group();
          pivot.position.copy(new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3()));
          baked.add(pivot);
          wheelTargets.set(object, pivot);
          wheels.push(pivot);
        });
        const sourceGeometries = new Set<THREE.BufferGeometry>();
        model.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          let ancestor: THREE.Object3D | null = o;
          let target = baked;
          while (ancestor) {
            const wheel = wheelTargets.get(ancestor);
            if (wheel) { target = wheel; break; }
            ancestor = ancestor.parent;
          }
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          if (target !== baked) geometry.translate(-target.position.x, -target.position.y, -target.position.z);
          sourceGeometries.add(o.geometry);
          if (Array.isArray(o.material) || o.material.transparent) {
            target.add(new THREE.Mesh(geometry, o.material));
            return;
          }
          const key =
            target.uuid + o.material.uuid +
            Object.keys(geometry.attributes).sort().join(",") +
            Boolean(geometry.index);
          const batch = batches.get(key) ?? {
            geometries: [] as THREE.BufferGeometry[],
            material: o.material,
            target,
          };
          batch.geometries.push(geometry);
          batches.set(key, batch);
        });
        batches.forEach(({ geometries, material, target }) => {
          const merged = mergeGeometries(geometries);
          if (merged) {
            target.add(new THREE.Mesh(merged, material));
            geometries.forEach((g) => g.dispose());
          } else
            geometries.forEach((g) => target.add(new THREE.Mesh(g, material)));
        });
        sourceGeometries.forEach((g) => g.dispose());
        model = baked;
        paint(initialColor.current);
        scene.add(model);
        setReady(true);
        renderer.domElement.dataset.loaded = "true";
        renderer.domElement.dataset.wheelCount = String(wheels.length);
      },
      (event) => {
        if (!disposed && event.total)
          setProgress(Math.round((event.loaded / event.total) * 100));
      },
      () => {
        if (!disposed) setError("load");
      },
    );
    api.current = {
      reset,
      view: changeView,
      zoom: (factor) => {
        camera.position
          .sub(controls.target)
          .multiplyScalar(factor)
          .add(controls.target);
        controls.update();
      },
      rotate: (value) => {
        controls.autoRotate = value;
      },
      paint,
    };
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const nextFraming = Math.max(1, 1.65 / camera.aspect);
      camera.position
        .sub(controls.target)
        .multiplyScalar(nextFraming / framing)
        .add(controls.target);
      framing = nextFraming;
      camera.updateProjectionMatrix();
      needsRender = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const points = (vehicle.hotspots ?? []).map(point => ({ ...point, vector: new THREE.Vector3(...point.position) }));
    const projected = new THREE.Vector3();
    const render = (now = 0) => {
      frame = requestAnimationFrame(render);
      if (document.hidden) { lastFrame = now; return; }
      if (now - lastFrame < 32) return;
      const dt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;
      const input = motion.current;
      const canMove = input.enabled && input.connected && !reducedMotion.matches && Number.isFinite(input.speed) && input.speed > 0;
      const targetSpeed = canMove ? Math.min(input.speed / 18, 5) : 0;
      visualSpeed = canMove ? THREE.MathUtils.damp(visualSpeed, targetSpeed, 4, dt) : 0;
      const wasVisible = road.visible;
      road.visible = canMove && !!model;
      if (road.visible || wasVisible) needsRender = true;
      if (road.visible) {
        distance = (distance + visualSpeed * dt) % 14.4;
        road.children.forEach((dash, i) => { dash.position.z = ((i % 12) * 1.2 - distance + 14.4) % 14.4 - 7.2; });
        wheels.forEach((wheel) => { wheel.rotation.x = (wheel.rotation.x + visualSpeed * dt / 0.34) % (Math.PI * 2); });
      }
      renderer.domElement.dataset.motion = road.visible ? "running" : "stopped";
      renderer.domElement.dataset.travel = distance.toFixed(3);
      controls.update();
      if (!needsRender && points.every(point => !tags.current[point.id] || tags.current[point.id]?.style.left)) return;
      renderer.render(scene, camera);
      needsRender = false;
      for (const point of points) {
        const tag = tags.current[point.id];
        if (!tag) continue;
        projected.copy(point.vector).project(camera);
        const labelOnLeft = projected.x > 0.1;
        tag.style.transform = labelOnLeft ? "translate(calc(-100% + 10px), -50%)" : "translate(-10px, -50%)";
        tag.style.flexDirection = labelOnLeft ? "row-reverse" : "row";
        tag.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
        tag.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
        tag.style.visibility = Math.abs(projected.x) > 0.95 || Math.abs(projected.y) > 0.9 || Math.abs(projected.z) > 1 ? "hidden" : "visible";
      }
    };
    render();
    const lost = (event: Event) => {
      event.preventDefault();
      setError("context");
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      if (model) disposeModel(model);
      dashGeometry.dispose();
      roadMaterial.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
      shadowTexture.dispose();
      replacedTextures.forEach((texture) => texture.dispose());
      env.dispose();
      pmrem.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, [retry, vehicle]);
  useEffect(() => {
    initialColor.current = color;
    api.current?.paint(color);
  }, [color]);
  // The 3D canvas is created once per car; its description changes with the interface language.
  useEffect(() => {
    host.current?.querySelector("canvas")?.setAttribute("aria-label", `${t("Model", "Model")} ${vehicle.brand} ${vehicle.name} 3D. ${t("Kéo để xoay, cuộn để phóng to.", "Drag to rotate, scroll to zoom.")}`);
  }, [t, vehicle, retry]);
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setError("fullscreen");
    }
  };
  return (
    <div className={`viewer ${hot ? "thermal-danger" : ""} ${scanning ? "is-scanning" : ""}`} ref={root}>
      <div className="model-wordmark" aria-hidden="true">
        {vehicle.id === "bmw-m2" ? "M2" : vehicle.brand}
      </div>
      <div className="viewer-topline">
        <span>
          <span className="tiny-dot" /> DIGITAL TWIN
        </span>
        <span>
          {vehicle.name} / {vehicle.year}
        </span>
      </div>
      <div className="three-host" ref={host} />
      {!ready && !error && (
        <div className="viewer-loading" role="status">
          <LoaderCircle className="spin" size={24} />
          <span>{t("Đang đưa xe vào garage…", "Bringing the car into the garage…")} {progress}%</span>
        </div>
      )}
      {error && (
        <div className="viewer-loading error" role="alert">
          <AlertTriangle />
          <span>{{
            webgl: t("Trình duyệt chưa hỗ trợ WebGL. Hãy bật tăng tốc phần cứng để xem xe 3D.", "This browser has no WebGL. Enable hardware acceleration to view the 3D car."),
            load: t("Không tải được model 3D. Hãy thử tải lại.", "Could not load the 3D model. Try again."),
            context: t("WebGL đã bị gián đoạn. Tải lại model để tiếp tục.", "WebGL was interrupted. Reload the model to continue."),
            fullscreen: t("Trình duyệt không hỗ trợ toàn màn hình.", "Fullscreen is not supported in this browser."),
          }[error]}</span>
          <button
            onClick={() => {
              setError("");
              setReady(false);
              setProgress(0);
              setRotating(false);
              setRetry((v) => v + 1);
            }}
          >
            {t("Tải lại model", "Reload model")}
          </button>
        </div>
      )}
      {ready && !error && <button className="driving-toggle" aria-pressed={motionEnabled}
        onClick={() => setMotionEnabled(value => !value)}
        title={t("Chuyển động minh họa theo telemetry; tự dừng khi mất kết nối hoặc bật giảm chuyển động", "Illustrative motion from telemetry; stops when offline or with reduced motion")}>
        {motionEnabled ? <Pause size={13} /> : <Play size={13} />}
        {motionEnabled ? t("Tạm dừng hiệu ứng", "Pause motion") : t("Bật hiệu ứng xe chạy", "Play driving motion")}
      </button>}
      <div className="camera-presets" aria-label={t("Góc nhìn nhanh", "Quick views")}>
        {[["perspective", t("Góc 3/4", "3/4 view")], ["front", t("Trước", "Front")], ["rear", t("Sau", "Rear")], ["side", t("Bên hông", "Side")], ["top", t("Từ trên", "Top")]].map(([id, label]) => (
          <button key={id} disabled={!ready || !!error} aria-pressed={view === id}
            onClick={() => { api.current?.view(id); setView(id); setRotating(false); }}>
            {label}
          </button>
        ))}
      </div>
      {ready && markers && !error && (vehicle.hotspots ?? []).map(hotspot => ({...hotspot, label: hotspot.id === "engine" ? t("Động cơ", "Engine") : t("Làm mát", "Cooling")})).map(point => (
        <button key={point.id} ref={el => { tags.current[point.id] = el; }}
          className={`engine-marker sensor-${point.id} heat-${thermalLevel(telemetry,point.id)}`}
          aria-label={`${t("Xem", "View")} ${point.label}`} title={`${point.label} · ${pick(thermalLabels[thermalLevel(telemetry,point.id)], lang)}`} aria-expanded={detail === point.id}
          aria-controls="sensor-detail"
          onClick={() => setDetail(detail === point.id ? null : point.id)}>
          <span className="marker-point" />
          <span className="marker-label">{point.label}
            {thermalLevel(telemetry,point.id) === "danger" && <AlertTriangle size={13} aria-label={t("Cảnh báo quá nhiệt", "Overheating warning")} />}
            <b>{telemetry.connected ? degrees(point.id === "engine" ? telemetry.oil : telemetry.coolant) : "—"}</b>
          </span>
        </button>
      ))}
      {ready && !error && hot && <div className="thermal-legend"><AlertTriangle size={13} /> {obd ? t("Vùng cảnh báo nhiệt", "Heat warning zone") : t("Vùng cảnh báo nhiệt · mô phỏng", "Heat warning zone · simulated")}</div>}
      {ready && !error && <div className={`viewer-assessment ${hot ? "critical" : status}`} role="status">
        <span className="tiny-dot" />
        {scanning ? t("Đang đối chiếu cảm biến…", "Cross-checking sensors…") : report ? report.title : telemetry.connected ? obd ? t("Chờ đánh giá · dữ liệu OBD", "Awaiting assessment · OBD data") : t("Chờ đánh giá · dữ liệu mô phỏng", "Awaiting assessment · simulated data") : t("Mất kết nối · chưa thể đánh giá", "Disconnected · cannot assess")}
      </div>}
      {detail && ready && markers && !error && (
        <div className="hotspot-detail" id="sensor-detail" role="region" aria-label={t("Chi tiết cảm biến", "Sensor details")}>
          <b>{detail === "engine" ? t("Vùng động cơ · nhiệt độ dầu", "Engine area · oil temperature") : t("Vùng két nước · nước làm mát", "Radiator area · coolant")}</b>
          <p>{obd ? t("Vị trí minh họa trên model · dữ liệu OBD", "Illustrative position on the model · OBD data") : t("Vị trí minh họa trên model · OBD mô phỏng", "Illustrative position on the model · simulated OBD")}</p>
          {telemetry.connected ? <dl>
            <div><dt>{detail === "engine" ? t("Dầu động cơ", "Engine oil") : t("Nước làm mát", "Coolant")}</dt><dd>{degrees(detail === "engine" ? telemetry.oil : telemetry.coolant)}</dd></div>
            <div><dt>{t("Ngoài trời", "Outside")}</dt><dd>{degrees(telemetry.ambient)}</dd></div>
            <div><dt>{t("Xu hướng nước làm mát", "Coolant trend")}</dt><dd>{telemetry.coolantTrend > 0 ? "+" : ""}{telemetry.coolantTrend}{t("°C/phút", "°C/min")}</dd></div>
          </dl> : <p>{t("Không có dữ liệu kết nối hiện tại.", "No live connection data.")}</p>}
          {report ? <><strong>{report.title}</strong><p>{report.summary}</p>
            <p>{report.recommendations[0]}</p>
            {detail === "cooling" && <p>{t("Chưa có cảm biến riêng để kết luận két nước hoặc quạt bị hỏng.", "No dedicated sensor to conclude the radiator or fan has failed.")}</p>}
          </> : <p>{scanning ? t("Đang phân tích…", "Analysing…") : t("Chưa có kết quả đánh giá cho dữ liệu hiện tại.", "No assessment for the current data yet.")}</p>}
          <button onClick={() => setDetail(null)}>{t("Đóng", "Close")}</button>
        </div>
      )}
      {scanning && <div className="scan-beam" />}
      <div className="viewer-bottom">
        <span className="drag-hint">
          <Rotate3D size={16} /> {t("Kéo để xoay · Cuộn để thu phóng", "Drag to rotate · Scroll to zoom")}
        </span>
        <div className="viewer-tools">
          <button
            aria-label={t("Thu nhỏ", "Zoom out")}
            onClick={() => api.current?.zoom(1.15)}
            disabled={!ready}
          >
            <ZoomOut size={17} />
          </button>
          <button
            aria-label={t("Phóng to", "Zoom in")}
            onClick={() => api.current?.zoom(0.85)}
            disabled={!ready}
          >
            <ZoomIn size={17} />
          </button>
          <button
            aria-label={t("Tự xoay xe", "Auto-rotate")}
            aria-pressed={rotating}
            onClick={() => {
              api.current?.rotate(!rotating);
              setRotating(!rotating);
              setView("custom");
            }}
            disabled={!ready}
          >
            <Rotate3D size={17} />
          </button>
          <button
            aria-label={t("Hiện cảm biến", "Show sensors")}
            aria-pressed={markers}
            onClick={() => setMarkers((v) => !v)}
          >
            <ScanLine size={17} />
          </button>
          <button
            aria-label={t("Đặt lại góc nhìn", "Reset view")}
            onClick={() => {
              api.current?.reset();
              setView("perspective");
              api.current?.rotate(false);
              setRotating(false);
            }}
            disabled={!ready}
          >
            <RotateCcw size={17} />
          </button>
          <button aria-label={t("Toàn màn hình", "Fullscreen")} onClick={fullscreen}>
            <Expand size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
