import React, { useEffect, useMemo, useRef, useState } from "react";
import SourcePanel from "./components/SourcePanel.jsx";
import Viewer from "./components/Viewer.jsx";
import DetectionPanel from "./components/DetectionPanel.jsx";

const WS_BASE =
  (location.protocol === "https:" ? "wss://" : "ws://") + location.host;

export default function App() {
  const [health, setHealth] = useState(null);
  const [source, setSource] = useState("synthetic"); // synthetic|webcam|rtsp|upload
  const [rtspUrl, setRtspUrl] = useState("");
  const [uploadId, setUploadId] = useState(null);
  const [fps, setFps] = useState(8);

  const [frame, setFrame] = useState(null);
  const [detections, setDetections] = useState([]);
  const [mode, setMode] = useState("mock");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [totals, setTotals] = useState({ النفايات: 0, الطعام: 0 });

  const wsRef = useRef(null);
  const webcamRef = useRef(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const stopStream = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  };

  const startStream = (overrides = {}) => {
    stopStream();
    setError(null);
    setFrame(null);
    setDetections([]);
    setTotals({ النفايات: 0, الطعام: 0 });

    const src = overrides.source || source;
    const value =
      overrides.value !== undefined
        ? overrides.value
        : src === "rtsp"
        ? rtspUrl
        : src === "upload"
        ? uploadId
        : "";

    if (src === "rtsp" && !value) {
      setError("الرجاء إدخال رابط RTSP صالح");
      return;
    }
    if (src === "upload" && !value) {
      setError("الرجاء رفع ملف فيديو أولًا");
      return;
    }

    const params = new URLSearchParams({ source: src, fps: String(fps) });
    if (value) params.set("value", value);
    const ws = new WebSocket(`${WS_BASE}/ws/stream?${params.toString()}`);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setError("تعذّر الاتصال بالخادم");
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "error") {
          setError(msg.message);
          stopStream();
          return;
        }
        if (msg.type === "frame") {
          setFrame(`data:image/jpeg;base64,${msg.image}`);
          setDetections(msg.detections || []);
          setMode(msg.mode || "mock");
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
      } catch (e) {
        console.error(e);
      }
    };
  };

  // Browser webcam path: capture frames locally, send to /api/detect/frame.
  useEffect(() => {
    let stream;
    let interval;
    let cancelled = false;

    async function start() {
      if (source !== "browser-webcam") return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) return;
        if (webcamRef.current) {
          webcamRef.current.srcObject = stream;
          await webcamRef.current.play();
        }
        const canvas = document.createElement("canvas");
        interval = setInterval(async () => {
          const v = webcamRef.current;
          if (!v || v.readyState < 2) return;
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(v, 0, 0);
          const data = canvas.toDataURL("image/jpeg", 0.75);
          try {
            const r = await fetch("/api/detect/frame", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image: data }),
            });
            const json = await r.json();
            setFrame(`data:image/jpeg;base64,${json.annotated}`);
            setDetections(json.detections || []);
            setMode(json.mode || "mock");
            if (json.detections?.length) {
              setTotals((prev) => {
                const next = { ...prev };
                for (const d of json.detections)
                  next[d.category] = (next[d.category] || 0) + 1;
                return next;
              });
            }
          } catch (e) {
            console.error(e);
          }
        }, Math.max(150, 1000 / fps));
        setConnected(true);
      } catch (e) {
        setError("تعذّر الوصول إلى الكاميرا: " + e.message);
      }
    }

    start();
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      setConnected(false);
    };
  }, [source, fps]);

  useEffect(() => () => stopStream(), []);

  const uploadVideo = async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const json = await r.json();
    setUploadId(json.id);
    setSource("upload");
    startStream({ source: "upload", value: json.id });
  };

  const modeLabel = useMemo(() => {
    if (mode === "yolo") return { text: "نموذج YOLO فعّال", cls: "live" };
    return { text: "وضع المحاكاة (Mock)", cls: "mock" };
  }, [mode]);

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
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="status-pill">
            <span className={`dot ${modeLabel.cls}`} />
            {modeLabel.text}
          </span>
          <span className="status-pill">
            <span className={`dot ${connected ? "live" : error ? "err" : ""}`} />
            {connected ? "متصل" : error ? "خطأ" : "غير متصل"}
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
          onStart={startStream}
          onStop={stopStream}
          onUpload={uploadVideo}
          connected={connected}
          uploadId={uploadId}
        />

        <Viewer
          frame={frame}
          webcamRef={webcamRef}
          source={source}
          mode={mode}
          error={error}
          totals={totals}
        />

        <DetectionPanel detections={detections} totals={totals} health={health} />
      </main>
    </div>
  );
}
