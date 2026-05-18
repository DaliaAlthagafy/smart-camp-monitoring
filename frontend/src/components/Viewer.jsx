import React, { useEffect, useRef } from "react";

/** Shared box-drawer used by both server-canvas and webcam-overlay paths.
 *  Coordinates are in the destination canvas pixel space (W x H). */
/** Cinematic overlay renderer.
 *
 *  Each detection is drawn as:
 *    1. a thin colored bbox stroke (with a faint dark contour halo
 *       so it reads on both bright and dark video frames),
 *    2. a tight, pill-shaped label that auto-sizes to the text it
 *       holds. The pill has a semi-transparent dark fill, a 1.5 px
 *       border in the detection color, and a subtle outer glow in
 *       high-clarity mode. Text is rendered in the detection's own
 *       colour for a clean tonal pairing with the border.
 *
 *  All sizing is proportional to the frame width so the overlay
 *  reads the same on 480p and 1080p sources. */
function drawBoxes(ctx, W, H, detections, clarity) {
  if (!detections?.length) return;
  const isHigh = clarity === "high";

  // Stroke + typography proportional to frame width.
  const stroke = isHigh ? Math.max(3, Math.round(W / 280)) : Math.max(2, Math.round(W / 420));
  const fontPx = isHigh ? Math.max(14, Math.round(W / 48)) : Math.max(12, Math.round(W / 60));
  const padX   = Math.max(7, Math.round(fontPx * 0.55));
  const padY   = Math.max(3, Math.round(fontPx * 0.30));
  const radius = Math.max(5, Math.round(fontPx * 0.42));

  ctx.font = `600 ${fontPx}px Cairo, "Segoe UI", Tahoma, Arial, sans-serif`;
  ctx.textBaseline = "middle";

  for (const d of detections) {
    const [x1, y1, x2, y2] = d.bbox;
    const bx = x1 * W, by = y1 * H;
    const bw = (x2 - x1) * W, bh = (y2 - y1) * H;

    // --- Bounding box -------------------------------------------------
    if (isHigh) {
      ctx.save();
      ctx.shadowColor = d.color;
      ctx.shadowBlur  = 14;
      ctx.strokeStyle = d.color;
      ctx.lineWidth   = stroke;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.restore();
    } else {
      // Thin dark contour gives contrast on bright video without the
      // bulky "double stroke" feel.
      ctx.strokeStyle = "rgba(0,0,0,0.45)";
      ctx.lineWidth   = stroke + 1;
      ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
      ctx.strokeStyle = d.color;
      ctx.lineWidth   = stroke;
      ctx.strokeRect(bx, by, bw, bh);
    }

    // --- Compact pill label ------------------------------------------
    const text = `${d.category} ${Math.round(d.confidence * 100)}%`;
    const textW = Math.ceil(ctx.measureText(text).width);
    const labelW = textW + padX * 2;
    const labelH = fontPx + padY * 2;

    // Default: label sits flush against the top edge of the box.
    let lx = bx;
    let ly = by - labelH - 3;
    // Flip the label below the box when there's no room above.
    if (ly < 1) ly = Math.min(H - labelH - 1, by + 3);
    // Clamp horizontally inside the frame.
    if (lx + labelW > W) lx = Math.max(0, W - labelW);
    if (lx < 0) lx = 0;

    // Subtle glow in high-clarity mode (cheap — only applies to the fill).
    if (isHigh) {
      ctx.save();
      ctx.shadowColor = d.color;
      ctx.shadowBlur  = 10;
    }
    // Semi-transparent dark pill, no oversized rectangle.
    ctx.fillStyle = "rgba(10, 14, 23, 0.82)";
    roundRect(ctx, lx, ly, labelW, labelH, radius);
    ctx.fill();
    if (isHigh) ctx.restore();

    // Crisp 1.5 px border in the detection colour — gives the label a
    // tonal accent without using a separate solid stripe.
    ctx.strokeStyle = d.color;
    ctx.lineWidth   = 1.5;
    roundRect(ctx, lx + 0.75, ly + 0.75, labelW - 1.5, labelH - 1.5, Math.max(0, radius - 1));
    ctx.stroke();

    // Text in the detection's own colour, vertically centred.
    ctx.fillStyle = d.color;
    ctx.fillText(text, lx + padX, ly + labelH / 2 + 1);
  }
}

/** Path-only rounded rectangle helper. Caller invokes fill() / stroke()
 *  so the same path can be reused for both. */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
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
