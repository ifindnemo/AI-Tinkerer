"use client";

import { useEffect, useRef, useState } from "react";
import {thermalLevel, thermalLabels} from "@/lib/thermal-status";
import type { Analysis, Telemetry } from "@/lib/telemetry";
import type { Vehicle } from "@/lib/vehicles";
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
}: {
  vehicle: Vehicle;
  color: string;
  scanning: boolean;
  telemetry: Telemetry;
  analysis: Analysis | null;
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
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
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
        setError(
          "Trình duyệt chưa hỗ trợ WebGL. Hãy bật tăng tốc phần cứng để xem xe 3D.",
        ),
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      "aria-label",
      `Model ${vehicle.brand} ${vehicle.name} 3D. Kéo để xoay, cuộn để phóng to.`,
    );
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
        if (!disposed) setError("Không tải được model 3D. Hãy thử tải lại.");
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
      setError("WebGL đã bị gián đoạn. Tải lại model để tiếp tục.");
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
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setError("Trình duyệt không hỗ trợ toàn màn hình.");
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
          <span>Đang đưa xe vào garage… {progress}%</span>
        </div>
      )}
      {error && (
        <div className="viewer-loading error" role="alert">
          <AlertTriangle />
          <span>{error}</span>
          <button
            onClick={() => {
              setError("");
              setReady(false);
              setProgress(0);
              setRotating(false);
              setRetry((v) => v + 1);
            }}
          >
            Tải lại model
          </button>
        </div>
      )}
      {ready && !error && <button className="driving-toggle" aria-pressed={motionEnabled}
        onClick={() => setMotionEnabled(value => !value)}
        title="Chuyển động minh họa theo telemetry; tự dừng khi mất kết nối hoặc bật giảm chuyển động">
        {motionEnabled ? <Pause size={13} /> : <Play size={13} />}
        {motionEnabled ? "Tạm dừng hiệu ứng" : "Bật hiệu ứng xe chạy"}
      </button>}
      <div className="camera-presets" aria-label="Góc nhìn nhanh">
        {[["perspective", "Góc 3/4"], ["front", "Trước"], ["rear", "Sau"], ["side", "Bên hông"], ["top", "Từ trên"]].map(([id, label]) => (
          <button key={id} disabled={!ready || !!error} aria-pressed={view === id}
            onClick={() => { api.current?.view(id); setView(id); setRotating(false); }}>
            {label}
          </button>
        ))}
      </div>
      {ready && markers && !error && (vehicle.hotspots ?? []).map(point => (
        <button key={point.id} ref={el => { tags.current[point.id] = el; }}
          className={`engine-marker sensor-${point.id} heat-${thermalLevel(telemetry,point.id)}`}
          aria-label={`Xem ${point.label}`} title={`${point.label} · ${thermalLabels[thermalLevel(telemetry,point.id)]}`} aria-expanded={detail === point.id}
          aria-controls="sensor-detail"
          onClick={() => setDetail(detail === point.id ? null : point.id)}>
          <span className="marker-point" />
          <span className="marker-label">{point.label}
            {thermalLevel(telemetry,point.id) === "danger" && <AlertTriangle size={13} aria-label="Cảnh báo quá nhiệt" />}
            <b>{telemetry.connected ? `${point.id === "engine" ? telemetry.oil : telemetry.coolant}°C` : "—"}</b>
          </span>
        </button>
      ))}
      {ready && !error && hot && <div className="thermal-legend"><AlertTriangle size={13} /> Vùng cảnh báo nhiệt · mô phỏng</div>}
      {ready && !error && <div className={`viewer-assessment ${hot ? "critical" : status}`} role="status">
        <span className="tiny-dot" />
        {scanning ? "Đang đối chiếu cảm biến…" : report ? report.title : telemetry.connected ? "Chọn Analysis để đánh giá · dữ liệu mô phỏng" : "Mất kết nối · chưa thể đánh giá"}
      </div>}
      {detail && ready && markers && !error && (
        <div className="hotspot-detail" id="sensor-detail" role="region" aria-label="Chi tiết cảm biến">
          <b>{detail === "engine" ? "Vùng động cơ · nhiệt độ dầu" : "Vùng két nước · nước làm mát"}</b>
          <p>Vị trí minh họa trên model · OBD mô phỏng</p>
          {telemetry.connected ? <dl>
            <div><dt>{detail === "engine" ? "Dầu động cơ" : "Nước làm mát"}</dt><dd>{detail === "engine" ? telemetry.oil : telemetry.coolant}°C</dd></div>
            <div><dt>Ngoài trời</dt><dd>{telemetry.ambient}°C</dd></div>
            <div><dt>Xu hướng nước làm mát</dt><dd>{telemetry.coolantTrend > 0 ? "+" : ""}{telemetry.coolantTrend}°C/phút</dd></div>
          </dl> : <p>Không có dữ liệu kết nối hiện tại.</p>}
          {report ? <><strong>{report.title}</strong><p>{report.summary}</p>
            <p>{report.recommendations[0]}</p>
            {detail === "cooling" && <p>Chưa có cảm biến riêng để kết luận két nước hoặc quạt bị hỏng.</p>}
          </> : <p>{scanning ? "Đang phân tích…" : "Chưa có kết quả Analysis cho dữ liệu hiện tại."}</p>}
          <button onClick={() => setDetail(null)}>Đóng</button>
        </div>
      )}
      {scanning && <div className="scan-beam" />}
      <div className="viewer-bottom">
        <span className="drag-hint">
          <Rotate3D size={16} /> Kéo để xoay · Cuộn để thu phóng
        </span>
        <div className="viewer-tools">
          <button
            aria-label="Thu nhỏ"
            onClick={() => api.current?.zoom(1.15)}
            disabled={!ready}
          >
            <ZoomOut size={17} />
          </button>
          <button
            aria-label="Phóng to"
            onClick={() => api.current?.zoom(0.85)}
            disabled={!ready}
          >
            <ZoomIn size={17} />
          </button>
          <button
            aria-label="Tự xoay xe"
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
            aria-label="Hiện cảm biến"
            aria-pressed={markers}
            onClick={() => setMarkers((v) => !v)}
          >
            <ScanLine size={17} />
          </button>
          <button
            aria-label="Đặt lại góc nhìn"
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
          <button aria-label="Toàn màn hình" onClick={fullscreen}>
            <Expand size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
