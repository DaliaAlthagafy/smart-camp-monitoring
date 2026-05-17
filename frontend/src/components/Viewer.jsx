import React from "react";

export default function Viewer({ frame, webcamRef, source, mode, error, totals }) {
  const showVideo = source === "browser-webcam" && !frame;
  return (
    <section className="card">
      <h2>الواجهة المباشرة</h2>
      <div className="viewer">
        <div className="overlay">
          <span className="tag">المصدر: {sourceLabel(source)}</span>
          <span className="tag">المحرّك: {mode === "yolo" ? "YOLO" : "Mock"}</span>
        </div>

        {showVideo && (
          <video ref={webcamRef} autoPlay muted playsInline />
        )}
        {frame && <img src={frame} alt="live frame" />}
        {!frame && !showVideo && (
          <div className="placeholder">
            {error ? error : "اختر مصدرًا ثم اضغط « بدء البث »"}
          </div>
        )}
      </div>

      <div className="stats">
        <div className="stat waste">
          <div className="label">النفايات (إجمالي الاكتشافات)</div>
          <div className="value">{totals["النفايات"] || 0}</div>
        </div>
        <div className="stat food">
          <div className="label">الطعام (إجمالي الاكتشافات)</div>
          <div className="value">{totals["الطعام"] || 0}</div>
        </div>
      </div>
    </section>
  );
}

function sourceLabel(s) {
  switch (s) {
    case "synthetic":      return "بث تجريبي";
    case "browser-webcam": return "كاميرا المتصفح";
    case "webcam":         return "كاميرا الخادم";
    case "rtsp":           return "RTSP";
    case "upload":         return "ملف فيديو";
    default:               return s;
  }
}
