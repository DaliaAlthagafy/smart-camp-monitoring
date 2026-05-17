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
  speed, setSpeed,
  skip, setSkip,
  clarity, setClarity,
  onStart, onStop, onUpload,
  isRunning, uploadId,
}) {
  const fileRef = useRef(null);
  const showSpeed = source === "upload" || source === "synthetic";

  return (
    <aside className="card">
      <h2>مصدر البث</h2>
      <div className="source-group">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            className={`source-btn ${source === s.id ? "active" : ""}`}
            onClick={() => setSource(s.id)}
            disabled={isRunning}
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
            disabled={isRunning}
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
            disabled={isRunning}
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

      <div className="grid-2">
        <div className="field">
          <label>الإطارات في الثانية (FPS)</label>
          <select
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            disabled={isRunning}
          >
            {[4, 8, 12, 15, 20, 24, 30].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        {showSpeed && (
          <div className="field">
            <label>سرعة التحليل</label>
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              disabled={isRunning}
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
              <option value={8}>8x</option>
            </select>
          </div>
        )}

        <div className="field">
          <label>تخطّي الإطارات</label>
          <select
            value={skip}
            onChange={(e) => setSkip(Number(e.target.value))}
            disabled={isRunning}
          >
            <option value={1}>كل إطار</option>
            <option value={2}>كل إطار ثانٍ</option>
            <option value={3}>كل إطار ثالث</option>
            <option value={5}>كل خامس</option>
          </select>
        </div>

        <div className="field">
          <label>وضوح الصندوق</label>
          <select
            value={clarity}
            onChange={(e) => setClarity(e.target.value)}
          >
            <option value="normal">عادي</option>
            <option value="high">عالي</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" onClick={onStart} disabled={isRunning}>
          ▶ بدء التحليل
        </button>
        <button className="btn danger" onClick={onStop} disabled={!isRunning}>
          ■ إيقاف التحليل
        </button>
      </div>

      <div className="footer-note">
        لرفع كفاءة معالجة الفيديو: ارفع FPS إلى 24/30، فعّل « تخطّي
        الإطارات » أو زِد « سرعة التحليل ». وضوح الصندوق « عالي »
        يضيف توهجًا وحدودًا أعرض لإبراز الاكتشافات.
      </div>
    </aside>
  );
}
