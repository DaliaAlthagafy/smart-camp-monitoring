import React, { useEffect, useRef } from "react";

/** Shared box-drawer used by both server-canvas and webcam-overlay paths.
 *  Coordinates are in the destination canvas pixel space (W x H). */
function drawBoxes(ctx, W, H, detections, clarity) {
  if (!detections?.length) return;
  const isHigh = clarity === "high";

  // Scale styling with frame size so it reads at any resolution.
  const baseStroke = isHigh ? Math.max(5, Math.round(W / 180)) : Math.max(3, Math.round(W / 320));
  const fontPx     = isHigh ? Math.max(18, Math.round(W / 38)) : Math.max(14, Math.round(W / 52));
  const labelPadX  = isHigh ? 10 : 7;
  const labelH     = Math.round(fontPx * 1.55);
  const stripeW    = isHigh ? 6 : 4;

  ctx.font = `700 ${fontPx}px Cairo, "Segoe UI", Tahoma, Arial, sans-serif`;
  ctx.textBaseline = "middle";

  for (const d of detections) {
    const [x1, y1, x2, y2] = d.bbox;
    const bx = x1 * W, by = y1 * H;
    const bw = (x2 - x1) * W, bh = (y2 - y1) * H;

    // Outer glow for high-clarity mode.
    if (isHigh) {
      ctx.save();
      ctx.shadowColor = d.color;
      ctx.shadowBlur  = 18;
      ctx.strokeStyle = d.color;
      ctx.lineWidth   = baseStroke + 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    }

    // Main box: bright stroke + thin dark outline for contrast on any background.
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth   = baseStroke + 2;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.strokeStyle = d.color;
    ctx.lineWidth   = baseStroke;
    ctx.strokeRect(bx, by, bw, bh);

    // Label
    const text = `${d.category} · ${Math.round(d.confidence * 100)}%`;
    const metrics = ctx.measureText(text);
    const lw = Math.ceil(metrics.width) + labelPadX * 2 + stripeW + 6;
    let lx = bx;
    let ly = by - labelH - 2;
    if (ly < 0) ly = by + 2;                       // flip below if no room above
    if (lx + lw > W) lx = Math.max(0, W - lw);     // keep on-screen horizontally

    // Semi-transparent label background.
    ctx.fillStyle = "rgba(8, 11, 20, 0.82)";
    roundRect(ctx, lx, ly, lw, labelH, 6, true, false);

    // Color stripe.
    ctx.fillStyle = d.color;
    ctx.fillRect(lx, ly, stripeW, labelH);

    // Text.
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, lx + stripeW + labelPadX, ly + labelH / 2 + 1);
  }
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

/** Canvas that decodes the server JPEG and draws bboxes on top. */
function ServerCanvas({ frameDataUrl, detections, clarity }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const detectionsRef = useRef([]);
  detectionsRef.current = detections;

  useEffect(() => {
    if (!imgRef.current) imgRef.current = new Image();
    const img = imgRef.current;
    if (!frameDataUrl) return;
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      if (c.width !== img.naturalWidth)  c.width  = img.naturalWidth;
      if (c.height !== img.naturalHeight) c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      drawBoxes(ctx, c.width, c.height, detectionsRef.current, clarity);
    };
    img.src = frameDataUrl;
  }, [frameDataUrl, clarity]);

  // Redraw when detections change without re-decoding the JPEG.
  useEffect(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img || !img.complete || !img.naturalWidth) return;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    drawBoxes(ctx, c.width, c.height, detections, clarity);
  }, [detections, clarity]);

  return <canvas ref={canvasRef} className="server-canvas" />;
}

/** Overlay canvas aligned to the live <video> element (browser webcam). */
function WebcamOverlay({ webcamRef, containerRef, detections, clarity }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = webcamRef.current;
    const container = containerRef.current;
    if (!canvas || !video || !container) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width  = Math.round(rect.width  * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width  = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      const s = Math.min(rect.width / vw, rect.height / vh);
      const dw = vw * s, dh = vh * s;
      const dx = (rect.width  - dw) / 2;
      const dy = (rect.height - dh) / 2;

      ctx.save();
      ctx.translate(dx, dy);
      drawBoxes(ctx, dw, dh, detections, clarity);
      ctx.restore();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [detections, clarity, webcamRef, containerRef]);

  return <canvas ref={canvasRef} className="overlay-canvas" />;
}

export default function Viewer({
  frame, webcamRef, source, engine, status, statusLabel,
  liveFps, detections, error, clarity,
  modeLabel,
}) {
  const containerRef = useRef(null);
  const showWebcam = source === "browser-webcam";

  return (
    <section className="card viewer-card">
      <div className="viewer cinematic" ref={containerRef}>
        {/* Browser webcam: persistent <video> + overlay canvas. */}
        <video
          ref={webcamRef}
          autoPlay
          muted
          playsInline
          style={{ display: showWebcam ? "block" : "none" }}
        />
        {showWebcam && (
          <WebcamOverlay
            webcamRef={webcamRef}
            containerRef={containerRef}
            detections={detections}
            clarity={clarity}
          />
        )}

        {/* Server-side sources: canvas decodes JPEG + draws boxes. */}
        {!showWebcam && frame && (
          <ServerCanvas
            frameDataUrl={frame}
            detections={detections}
            clarity={clarity}
          />
        )}

        {!showWebcam && !frame && (
          <div className="placeholder">
            {error
              ? error
              : status === "idle" || status === "stopped"
              ? "اختر مصدرًا ثم اضغط « بدء التحليل »"
              : "في انتظار أول إطار…"}
          </div>
        )}

        {/* Minimal corner FPS readout — only when something is streaming. */}
        {(frame || showWebcam) && (
          <div className="viewer-fps" aria-hidden="true">
            {liveFps.toFixed(1)} <span>fps</span>
          </div>
        )}
      </div>

      {/* Below-viewer KPI grid removed — operational metrics now live in
          the dedicated StatsPanel on the left of the dashboard. */}

      <div className="viewer-footer">
        <span className="vf-item">
          <span className="vf-dot" style={{ background: "#86efac" }} />
          أخضر = التزام
        </span>
        <span className="vf-item">
          <span className="vf-dot" style={{ background: "#f59e0b" }} />
          برتقالي = تحذير
        </span>
        <span className="vf-item">
          <span className="vf-dot" style={{ background: "#ef4444" }} />
          أحمر = مخالفة
        </span>
      </div>
    </section>
  );
}
