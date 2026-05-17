import React from "react";

export default function DetectionPanel({ detections, totals, health, engine }) {
  const isYolo = (engine || health?.engine) === "YOLO";
  return (
    <aside className="card">
      <h2>محرّك الكشف</h2>
      <div className={`engine-banner ${isYolo ? "ok" : "warn"}`}>
        {isYolo ? (
          <>
            <strong>YOLO حقيقي</strong>
            <div>الاستدلال يجري على الأوزان المدرَّبة لكل إطار.</div>
          </>
        ) : (
          <>
            <strong>وضع المحاكاة (Mock)</strong>
            <div>
              {health?.is_lfs_pointer
                ? "ملف النموذج مؤشر Git-LFS فقط — نفّذ git lfs pull ثم أعد تحميل المحرّك."
                : health?.model_present
                ? "النموذج موجود لكن لم يُحمَّل — تحقّق من تثبيت ultralytics."
                : "لم يتم العثور على waste_model.pt — يعمل النظام في وضع تجريبي."}
            </div>
          </>
        )}
      </div>

      <h2 style={{ marginTop: 22 }}>الاكتشافات الحالية</h2>
      {detections.length === 0 ? (
        <div className="empty">لا توجد اكتشافات في الإطار الحالي</div>
      ) : (
        <div className="det-list">
          {detections.map((d, i) => (
            <div className="det-item" key={i}>
              <div className="left">
                <span className="swatch" style={{ background: d.color }} />
                <strong>{d.category}</strong>
                <span className="conf">({d.category_en})</span>
              </div>
              <span className="conf">
                {Math.round(d.confidence * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 22 }}>الفئات المُراقَبة</h2>
      <div className="det-list">
        {(health?.categories || [
          { ar: "النفايات", en: "waste", color: "#ef4444" },
          { ar: "الطعام",   en: "food",  color: "#22c55e" },
        ]).map((c) => (
          <div className="det-item" key={c.ar}>
            <div className="left">
              <span className="swatch" style={{ background: c.color }} />
              <strong>{c.ar}</strong>
              <span className="conf">({c.en})</span>
            </div>
            <span className="conf">{totals?.[c.ar] || 0}</span>
          </div>
        ))}
      </div>

      <div className="footer-note">
        مسار النموذج: <code dir="ltr">backend/models/waste_model.pt</code>
      </div>
    </aside>
  );
}
