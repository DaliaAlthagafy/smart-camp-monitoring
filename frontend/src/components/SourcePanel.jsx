import React, { useRef } from "react";

const SOURCES = [
  { id: "synthetic",      label: "بث تجريبي",       badge: "Synthetic" },
  { id: "browser-webcam", label: "كاميرا المتصفح",  badge: "Webcam" },
  { id: "webcam",         label: "كاميرا الخادم",   badge: "Server cam" },
  { id: "rtsp",           label: "كاميرا IP / RTSP", badge: "RTSP" },
  { id: "upload",         label: "ملف فيديو",       badge: "Upload" },
];

export default function SourcePanel({
  source, setSource,
  rtspUrl, setRtspUrl,
  fps, setFps,
  onStart, onStop, onUpload,
  connected, uploadId,
}) {
  const fileRef = useRef(null);
  const needsManualStart = source !== "browser-webcam";

  return (
    <aside className="card">
      <h2>مصدر البث</h2>
      <div className="source-group">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            className={`source-btn ${source === s.id ? "active" : ""}`}
            onClick={() => setSource(s.id)}
          >
            <span>{s.label}</span>
            <span className="badge">{s.badge}</span>
          </button>
        ))}
      </div>

      {source === "rtsp" && (
        <div className="field">
          <label>رابط RTSP / HTTP</label>
          <input
            type="text"
            value={rtspUrl}
            onChange={(e) => setRtspUrl(e.target.value)}
            placeholder="rtsp://user:pass@192.168.1.10:554/stream"
            dir="ltr"
          />
        </div>
      )}

      {source === "upload" && (
        <div className="field">
          <label>رفع فيديو (mp4/avi/mov)</label>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
            }}
          />
          {uploadId && (
            <div className="footer-note">المعرف: <code dir="ltr">{uploadId}</code></div>
          )}
        </div>
      )}

      <div className="field">
        <label>الإطارات في الثانية (FPS)</label>
        <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
          {[2, 4, 6, 8, 12, 15, 20].map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {needsManualStart && (
          <button className="btn primary" onClick={() => onStart()} disabled={connected}>
            بدء البث
          </button>
        )}
        <button className="btn danger" onClick={onStop} disabled={!connected}>
          إيقاف
        </button>
      </div>

      <div className="footer-note">
        كاميرا المتصفح تعمل محليًا داخل الجهاز، بينما باقي المصادر تُعالَج
        من الخادم عبر WebSocket.
      </div>
    </aside>
  );
}
