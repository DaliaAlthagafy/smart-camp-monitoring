import React, { useEffect, useRef } from "react";

export default function Viewer({
  frame, webcamRef, source, engine, status, statusLabel,
  liveFps, detections, error, totals,
}) {
  const overlayRef = useRef(null);
  const containerRef = useRef(null);

  // Draw bounding boxes on the canvas overlay (browser-webcam mode).
  useEffect(() => {
    if (source !== "browser-webcam") return;
    const canvas = overlayRef.current;
    const video = webcamRef.current;
    const container = containerRef.current;
    if (!canvas || !video || !container) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Compute the actual rendered video rectangle (object-fit: contain).
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      const scale = Math.min(rect.width / vw, rect.height / vh);
      const dw = vw * scale, dh = vh * scale;
      const dx = (rect.width - dw) / 2;
      const dy = (rect.height - dh) / 2;

      for (const d of detections) {
        const [x1, y1, x2, y2] = d.bbox;
        const bx = dx + x1 * dw;
        const by = dy + y1 * dh;
        const bw = (x2 - x1) * dw;
        const bh = (y2 - y1) * dh;
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, by, bw, bh);
        const label = `${d.category_en} ${Math.round(d.confidence * 100)}%`;
        ctx.font = "12px Cairo, sans-serif";
        const w = ctx.measureText(label).width + 10;
        ctx.fillStyle = d.color;
        ctx.fillRect(bx, by - 18, w, 16);
        ctx.fillStyle = "#0a0e17";
        ctx.fillText(label, bx + 5, by - 5);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [detections, source, webcamRef]);

  const showVideoEl = source === "browser-webcam";

  return (
    <section className="card">
      <h2>الواجهة المباشرة</h2>
      <div className="viewer" ref={containerRef}>
        <div className="overlay">
          <span className="tag">المصدر: {sourceLabel(source)}</span>
          <span className={`tag ${engine === "YOLO" ? "tag-live" : "tag-mock"}`}>
            المحرّك: {engine === "YOLO" ? "YOLO حقيقي" : "محاكاة"}
          </span>
          <span className="tag">FPS: {liveFps.toFixed(1)}</span>
          <span className={`tag status-${status}`}>{statusLabel}</span>
        </div>

        {/* Browser webcam: persistent <video> + canvas overlay. */}
        <video
          ref={webcamRef}
          autoPlay
          muted
          playsInline
          style={{ display: showVideoEl ? "block" : "none" }}
        />
        {showVideoEl && (
          <canvas ref={overlayRef} className="overlay-canvas" />
        )}

        {/* Server-side sources: annotated JPEG stream. */}
        {!showVideoEl && frame && <img src={frame} alt="live frame" />}

        {!showVideoEl && !frame && (
          <div className="placeholder">
            {error
              ? error
              : status === "idle" || status === "stopped"
              ? "اختر مصدرًا ثم اضغط « بدء التحليل »"
              : "في انتظار أول إطار…"}
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
