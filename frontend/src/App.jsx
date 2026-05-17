import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SourcePanel from "./components/SourcePanel.jsx";
import Viewer from "./components/Viewer.jsx";
import DetectionPanel from "./components/DetectionPanel.jsx";

const WS_BASE =
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

// Status state machine
//   idle      -> nothing running
//   live      -> webcam live analysis in progress
//   video     -> uploaded / rtsp / synthetic stream playing
//   stopped   -> user stopped
//   error     -> connection/source error
const STATUS_LABELS = {
  idle:    { ar: "متوقف",               cls: "" },
  live:    { ar: "جاري التحليل المباشر", cls: "live" },
  video:   { ar: "جاري معالجة الفيديو",  cls: "live" },
  stopped: { ar: "متوقف",               cls: "" },
  error:   { ar: "خطأ في التشغيل",       cls: "err" },
};

export default function App() {
  const [health, setHealth] = useState(null);
  const [source, setSource] = useState("synthetic");
  const [rtspUrl, setRtspUrl] = useState("");
  const [uploadId, setUploadId] = useState(null);
  const [fps, setFps] = useState(8);

  const [frame, setFrame] = useState(null);     // annotated JPEG (server-side sources)
  const [detections, setDetections] = useState([]);
  const [engine, setEngine] = useState("MOCK"); // "YOLO" | "MOCK"
  const [status, setStatus] = useState("idle"); // see STATUS_LABELS
  const [error, setError] = useState(null);
  const [liveFps, setLiveFps] = useState(0);
  const [totals, setTotals] = useState({ النفايات: 0, الطعام: 0 });

  const wsRef = useRef(null);
  const webcamRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const webcamLoopRef = useRef(null);
  const webcamInflightRef = useRef(false);
  const fpsWindowRef = useRef([]); // timestamps of recently delivered frames

  // ---------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => {
        setHealth(h);
        setEngine(h.engine || (h.detector_mode === "yolo" ? "YOLO" : "MOCK"));
      })
      .catch(() => setHealth(null));
  }, []);

  // ---------------------------------------------------------------------
  // FPS tracking
  // ---------------------------------------------------------------------
  const recordFrameTimestamp = useCallback(() => {
    const now = performance.now();
    const w = fpsWindowRef.current;
    w.push(now);
    while (w.length > 0 && now - w[0] > 1500) w.shift();
    if (w.length >= 2) {
      const span = (w[w.length - 1] - w[0]) / 1000;
      setLiveFps(span > 0 ? +(w.length / span).toFixed(1) : 0);
    } else {
      setLiveFps(0);
    }
  }, []);

  const resetFps = useCallback(() => {
    fpsWindowRef.current = [];
    setLiveFps(0);
  }, []);

  // ---------------------------------------------------------------------
  // Universal stop
  // ---------------------------------------------------------------------
  const stopAll = useCallback(() => {
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    if (webcamLoopRef.current) {
      clearInterval(webcamLoopRef.current);
      webcamLoopRef.current = null;
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop());
      webcamStreamRef.current = null;
    }
    if (webcamRef.current) {
      webcamRef.current.srcObject = null;
    }
    webcamInflightRef.current = false;
    resetFps();
    setStatus((s) => (s === "error" ? "error" : "stopped"));
  }, [resetFps]);

  useEffect(() => () => stopAll(), [stopAll]);

  // ---------------------------------------------------------------------
  // Server-side streams (synthetic / webcam-server / rtsp / upload)
  // ---------------------------------------------------------------------
  const startServerStream = useCallback(
    (src, value) => {
      const params = new URLSearchParams({ source: src, fps: String(fps) });
      if (value) params.set("value", value);
      const ws = new WebSocket(`${WS_BASE}/ws/stream?${params.toString()}`);
      wsRef.current = ws;

      ws.onopen = () => setStatus("video");
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setStatus((s) => (s === "video" ? "stopped" : s));
      };
      ws.onerror = () => {
        setError("تعذّر الاتصال بالخادم");
        setStatus("error");
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === "error") {
          setError(msg.message);
          setStatus("error");
          stopAll();
          return;
        }
        if (msg.type === "frame") {
          setFrame(`data:image/jpeg;base64,${msg.image}`);
          setDetections(msg.detections || []);
          if (msg.engine) setEngine(msg.engine);
          recordFrameTimestamp();
          if (msg.detections?.length) {
            setTotals((prev) => {
              const next = { ...prev };
              for (const d of msg.detections) {
                next[d.category] = (next[d.category] || 0) + 1;
              }
              return next;
            });
          }
        }
      };
    },
    [fps, recordFrameTimestamp, stopAll]
  );

  // ---------------------------------------------------------------------
  // Browser webcam — keep <video> always mounted, draw overlay on canvas,
  // and POST captured frames to /api/detect/frame on a continuous loop.
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

      const tick = async () => {
        const video = webcamRef.current;
        if (!video || video.readyState < 2) return;
        if (webcamInflightRef.current) return; // skip if previous request still pending
        webcamInflightRef.current = true;
        try {
          canvas.width  = video.videoWidth  || 640;
          canvas.height = video.videoHeight || 480;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          const r = await fetch("/api/detect/frame", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: dataUrl, source: "webcam", annotate: false }),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const json = await r.json();
          setDetections(json.detections || []);
          if (json.engine) setEngine(json.engine);
          recordFrameTimestamp();
          if (json.detections?.length) {
            setTotals((prev) => {
              const next = { ...prev };
              for (const d of json.detections)
                next[d.category] = (next[d.category] || 0) + 1;
              return next;
            });
          }
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
  }, [fps, recordFrameTimestamp]);

  // ---------------------------------------------------------------------
  // Start dispatcher
  // ---------------------------------------------------------------------
  const startAnalysis = useCallback(() => {
    stopAll();
    setError(null);
    setFrame(null);
    setDetections([]);
    setTotals({ النفايات: 0, الطعام: 0 });
    resetFps();

    if (source === "rtsp" && !rtspUrl) {
      setError("الرجاء إدخال رابط RTSP صالح"); setStatus("error"); return;
    }
    if (source === "upload" && !uploadId) {
      setError("الرجاء رفع ملف فيديو أولًا"); setStatus("error"); return;
    }

    if (source === "browser-webcam") {
      startBrowserWebcam();
    } else if (source === "synthetic") {
      startServerStream("synthetic");
    } else if (source === "webcam") {
      startServerStream("webcam", "0");
    } else if (source === "rtsp") {
      startServerStream("rtsp", rtspUrl);
    } else if (source === "upload") {
      startServerStream("upload", uploadId);
    }
  }, [
    source, rtspUrl, uploadId,
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
  const engineInfo = useMemo(() => {
    return engine === "YOLO"
      ? { text: "محرّك الكشف: YOLO حقيقي", cls: "live" }
      : { text: "محرّك الكشف: محاكاة (Mock)", cls: "mock" };
  }, [engine]);

  const isRunning = status === "live" || status === "video";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div>
            <h1>مراقبة المخيم الذكية</h1>
            <div className="sub">Smart Camp Monitoring · لوحة تحكم مباشرة</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`status-pill engine-${engineInfo.cls}`}>
            <span className={`dot ${engineInfo.cls}`} />
            {engineInfo.text}
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
        <SourcePanel
          source={source}
          setSource={setSource}
          rtspUrl={rtspUrl}
          setRtspUrl={setRtspUrl}
          fps={fps}
          setFps={setFps}
          onStart={startAnalysis}
          onStop={stopAll}
          onUpload={uploadVideo}
          isRunning={isRunning}
          uploadId={uploadId}
        />

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
          totals={totals}
        />

        <DetectionPanel detections={detections} totals={totals} health={health} engine={engine} />
      </main>
    </div>
  );
}
