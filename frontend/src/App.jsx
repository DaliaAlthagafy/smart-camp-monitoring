import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SourcePanel from "./components/SourcePanel.jsx";
import ModelsPanel from "./components/ModelsPanel.jsx";
import Viewer from "./components/Viewer.jsx";
import StatsPanel from "./components/StatsPanel.jsx";

const WS_BASE =
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

export const UI_VERSION = "hygiene-debug-v10";

/* All Arabic categories the backend can emit. Used to seed a fully
 * populated counts object so the dashboard never breaks because a
 * key is missing — values are recomputed every frame from the
 * current detections array (no historical accumulation). */
const ALL_CATEGORIES = [
  "النفايات",
  "صالح", "يحتاج فحص", "متعفن",
  "قفازات", "بدون قفازات",
  "كمامة",  "بدون كمامة",
  "غطاء رأس", "بدون غطاء رأس",
];

/** Live counts for the *current* frame only. Pass it the
 *  `detections` array straight from the most recent payload. */
function countsForFrame(detections) {
  const counts = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0]));
  for (const d of detections || []) {
    if (counts[d.category] !== undefined) {
      counts[d.category] += 1;
    } else {
      counts[d.category] = 1;
    }
  }
  return counts;
}

const LS_ACTIVE_MODELS = "scm.activeModels";

const STATUS_LABELS = {
  idle:    { ar: "متوقف",                cls: "" },
  live:    { ar: "جاري التحليل المباشر", cls: "live" },
  video:   { ar: "جاري معالجة الفيديو",  cls: "live" },
  stopped: { ar: "متوقف",                cls: "" },
  error:   { ar: "خطأ في التشغيل",        cls: "err" },
};

function defaultFpsFor(source) {
  if (source === "upload") return 30;
  // browser-webcam / server webcam — keep it real-time friendly.
  return 8;
}

function loadStoredActiveModels() {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_MODELS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {}
  return null;
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [models, setModels] = useState([]);
  const [activeModels, setActiveModels] = useState(
    () => loadStoredActiveModels() || ["waste"]
  );

  const [source, setSource] = useState("browser-webcam");
  const [uploadId, setUploadId] = useState(null);

  const [fps, setFps]       = useState(defaultFpsFor("browser-webcam"));
  const [speed, setSpeed]   = useState(1);
  const [skip, setSkip]     = useState(1);
  const [clarity, setClarity] = useState("high");

  const [frame, setFrame] = useState(null);
  const [detections, setDetections] = useState([]);
  const [engine, setEngine] = useState("MOCK");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [liveFps, setLiveFps] = useState(0);
  // `totals` is intentionally NOT stored — it's derived per-render from
  // `detections` so the dashboard always mirrors the current frame and
  // resets correctly when detections disappear.

  const wsRef = useRef(null);
  const webcamRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const webcamLoopRef = useRef(null);
  const webcamInflightRef = useRef(false);
  const fpsWindowRef = useRef([]);

  // ---------------------------------------------------------------------
  // Boot: pull health, then sync stored active models to backend.
  // ---------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const h = await fetch("/api/health").then((r) => r.json());
        setHealth(h);
        setEngine(h.engine || "MOCK");
        setModels(h.models || []);
        const available = (h.models || []).filter((m) => m.available).map((m) => m.name);
        let desired = loadStoredActiveModels();
        if (!desired || !desired.length) desired = h.active_models || ["waste"];
        desired = desired.filter((n) => available.includes(n));
        if (!desired.length && available.length) desired = [available[0]];
        if (!desired.length) desired = h.active_models || ["waste"];
        await applyActiveModels(desired, /*remoteSync*/ true);
        console.info(
          `%cSmart Camp Monitoring — UI ${UI_VERSION} · backend ${h.version || "?"}`,
          "background:#38bdf8;color:#0a0e17;padding:2px 8px;border-radius:4px;font-weight:700",
        );
      } catch (e) {
        console.error("health fetch failed", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------
  const applyActiveModels = useCallback(async (nextList, remoteSync = true) => {
    if (!Array.isArray(nextList) || nextList.length === 0) return;
    setActiveModels(nextList);
    try {
      localStorage.setItem(LS_ACTIVE_MODELS, JSON.stringify(nextList));
    } catch {}
    if (!remoteSync) return;
    try {
      const r = await fetch("/api/models/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_models: nextList }),
      });
      const json = await r.json();
      setModels(json.models || []);
      setActiveModels(json.active_models || nextList);
      if (json.engine) setEngine(json.engine);
    } catch (e) {
      console.error("model select failed", e);
    }
  }, []);

  // ---------------------------------------------------------------------
  useEffect(() => {
    setFps(defaultFpsFor(source));
    setSpeed(1);
    if (source !== "upload") setSkip(1);
  }, [source]);

  const recordFrameTimestamp = useCallback(() => {
    const now = performance.now();
    const w = fpsWindowRef.current;
    w.push(now);
    while (w.length > 0 && now - w[0] > 1500) w.shift();
    setLiveFps(w.length >= 2 ? +(w.length / ((w[w.length - 1] - w[0]) / 1000)).toFixed(1) : 0);
  }, []);

  const resetFps = useCallback(() => {
    fpsWindowRef.current = [];
    setLiveFps(0);
  }, []);

  const stopAll = useCallback(() => {
    if (wsRef.current) { try { wsRef.current.close(); } catch {} wsRef.current = null; }
    if (webcamLoopRef.current) { clearInterval(webcamLoopRef.current); webcamLoopRef.current = null; }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop());
      webcamStreamRef.current = null;
    }
    if (webcamRef.current) webcamRef.current.srcObject = null;
    webcamInflightRef.current = false;
    resetFps();
    setStatus((s) => (s === "error" ? "error" : "stopped"));
  }, [resetFps]);

  useEffect(() => () => stopAll(), [stopAll]);

  // ---------------------------------------------------------------------
  // Server-side stream
  // ---------------------------------------------------------------------
  const startServerStream = useCallback(
    (src, value) => {
      const params = new URLSearchParams({
        source:   src,
        fps:      String(fps),
        speed:    String(speed),
        skip:     String(skip),
        annotate: "false",
      });
      if (value) params.set("value", value);
      const ws = new WebSocket(`${WS_BASE}/ws/stream?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen  = () => setStatus("video");
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setStatus((s) => (s === "video" ? "stopped" : s));
      };
      ws.onerror = () => { setError("تعذّر الاتصال بالخادم"); setStatus("error"); };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "error") {
          setError(msg.message); setStatus("error"); stopAll(); return;
        }
        if (msg.type === "frame") {
          setFrame(`data:image/jpeg;base64,${msg.image}`);
          // Single source of truth for the StatsPanel — current-frame
          // detections only. No accumulator → counters reset when
          // detections disappear from the frame.
          setDetections(msg.detections || []);
          if (msg.engine) setEngine(msg.engine);
          recordFrameTimestamp();
        }
      };
    },
    [fps, speed, skip, recordFrameTimestamp, stopAll]
  );

  // ---------------------------------------------------------------------
  // Browser webcam loop
  // ---------------------------------------------------------------------
  const startBrowserWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      webcamStreamRef.current = stream;
      const v = webcamRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play();
      setStatus("live");

      const canvas = document.createElement("canvas");
      let tickCount = 0;

      const tick = async () => {
        const video = webcamRef.current;
        if (!video || video.readyState < 2) return;
        tickCount += 1;
        if (skip > 1 && (tickCount - 1) % skip !== 0) {
          recordFrameTimestamp();
          return;
        }
        if (webcamInflightRef.current) return;
        webcamInflightRef.current = true;
        try {
          canvas.width  = video.videoWidth  || 640;
          canvas.height = video.videoHeight || 480;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          const r = await fetch("/api/detect/frame", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ image: dataUrl, source: "webcam", annotate: false }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const json = await r.json();
          setDetections(json.detections || []);
          if (json.engine) setEngine(json.engine);
          recordFrameTimestamp();
        } catch (e) {
          console.error("webcam tick failed", e);
        } finally {
          webcamInflightRef.current = false;
        }
      };

      webcamLoopRef.current = setInterval(tick, Math.max(50, 1000 / fps));
    } catch (e) {
      setError("تعذّر الوصول إلى الكاميرا: " + e.message);
      setStatus("error");
    }
  }, [fps, skip, recordFrameTimestamp]);

  // ---------------------------------------------------------------------
  const startAnalysis = useCallback(() => {
    stopAll();
    setError(null);
    setFrame(null);
    setDetections([]);     // clears derived totals automatically
    resetFps();

    if (source === "upload" && !uploadId) {
      setError("الرجاء رفع ملف فيديو أولًا"); setStatus("error"); return;
    }

    if      (source === "browser-webcam") startBrowserWebcam();
    else if (source === "webcam")         startServerStream("webcam", "0");
    else if (source === "upload")         startServerStream("upload", uploadId);
  }, [
    source, uploadId,
    stopAll, resetFps, startBrowserWebcam, startServerStream,
  ]);

  const uploadVideo = async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const json = await r.json();
    setUploadId(json.id);
    setSource("upload");
  };

  const statusInfo = STATUS_LABELS[status] || STATUS_LABELS.idle;
  const engineInfo = useMemo(() => engine === "YOLO"
    ? { text: "محرّك الكشف: YOLO حقيقي", cls: "live" }
    : engine === "NONE"
    ? { text: "محرّك الكشف: لا يوجد نموذج نشط", cls: "err" }
    : { text: "محرّك الكشف: محاكاة (Mock)", cls: "mock" }, [engine]);

  const isRunning = status === "live" || status === "video";

  const modeLabel = useMemo(() => {
    const set = new Set(activeModels);
    const hygieneAll =
      set.has("gloves") && set.has("mask") && set.has("headcover");
    if (set.size === 5 && hygieneAll && set.has("waste") && set.has("food")) {
      return "كل النماذج (نفايات + طعام + التزام العاملين)";
    }
    if (hygieneAll && !set.has("waste") && !set.has("food")) {
      return "نماذج التزام العاملين (قفازات + كمامة + غطاء رأس)";
    }
    if (set.has("waste") && set.has("food") && set.size === 2) {
      return "النفايات + الطعام";
    }
    if (set.size === 1) {
      const only = activeModels[0];
      return ({
        waste:     "نموذج النفايات فقط",
        food:      "نموذج الطعام فقط",
        gloves:    "نموذج القفازات فقط",
        mask:      "نموذج الكمامة فقط",
        headcover: "نموذج غطاء الرأس فقط",
      })[only] || `نموذج ${only}`;
    }
    if (!activeModels.length) return "(لا يوجد نموذج نشط)";
    return `مخصّص: ${activeModels.join(" + ")}`;
  }, [activeModels]);

  // Derive current-frame totals from the live detections — the single
  // source of truth shared by the bbox overlay and the StatsPanel.
  const totals = useMemo(() => countsForFrame(detections), [detections]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <h1>مراقبة المخيم الذكية</h1>
            <div className="sub">
              Smart Camp Monitoring · لوحة تحكم مباشرة
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`status-pill engine-${engineInfo.cls}`}>
            <span className={`dot ${engineInfo.cls}`} />
            {engineInfo.text}
          </span>
          <span className="status-pill" title="الوضع المُختار من نماذج التحليل">
            <span className="dot" style={{ background: "#a78bfa" }} />
            الوضع: {modeLabel}
          </span>
          <span className={`status-pill status-${status}`}>
            <span className={`dot ${statusInfo.cls}`} />
            {statusInfo.ar}
          </span>
          <span className="status-pill">
            <span className="dot" style={{ background: "#38bdf8" }} />
            FPS: <strong style={{ marginInlineStart: 4 }}>{liveFps.toFixed(1)}</strong>
          </span>
        </div>
      </header>

      <main className="layout">
        {/* RTL: the first DOM child renders on the visual RIGHT.
            Order = controls (right) → viewer (center) → stats (left). */}
        <div className="col controls-col">
          <SourcePanel
            source={source} setSource={setSource}
            fps={fps} setFps={setFps}
            speed={speed} setSpeed={setSpeed}
            skip={skip} setSkip={setSkip}
            clarity={clarity} setClarity={setClarity}
            onStart={startAnalysis} onStop={stopAll}
            onUpload={uploadVideo}
            isRunning={isRunning} uploadId={uploadId}
          />

          <ModelsPanel
            models={models}
            activeModels={activeModels}
            onChange={(next) => applyActiveModels(next)}
          />
        </div>

        <Viewer
          frame={frame}
          webcamRef={webcamRef}
          source={source}
          engine={engine}
          status={status}
          statusLabel={statusInfo.ar}
          liveFps={liveFps}
          detections={detections}
          error={error}
          clarity={clarity}
          modeLabel={modeLabel}
        />

        <StatsPanel
          totals={totals}
          activeModels={activeModels}
          models={models}
          engine={engine}
        />
      </main>
    </div>
  );
}
