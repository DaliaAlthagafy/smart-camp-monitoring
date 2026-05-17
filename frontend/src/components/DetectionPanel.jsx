import React from "react";

export default function DetectionPanel({
  detections, totals, health, engine, activeModels = [], models = [],
}) {
  const isYolo = engine === "YOLO";
  const isNone = engine === "NONE";
  const byName = Object.fromEntries(models.map((m) => [m.name, m]));

  return (
    <aside className="card">
      <h2>محرّك الكشف</h2>
      <div className={`engine-banner ${isNone ? "warn" : isYolo ? "ok" : "warn"}`}>
        {isNone ? (
          <>
            <strong>لا يوجد نموذج نشط</strong>
            <div>اختر نموذجًا من قسم « نماذج التحليل ».</div>
          </>
        ) : isYolo ? (
          <>
            <strong>YOLO حقيقي</strong>
            <div>الاستدلال يجري على الأوزان المدرَّبة لكل إطار.</div>
          </>
        ) : (
          <>
            <strong>وضع المحاكاة (Mock)</strong>
            <div>أحد النماذج النشطة يعمل بمحاكاة لأن أوزانه غير محمَّلة.</div>
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
                <span className="model-pill" style={{ borderColor: d.color, color: d.color }}>
                  {({
                    waste:     "نموذج النفايات",
                    food:      "نموذج الطعام",
                    gloves:    "نموذج القفازات",
                    mask:      "نموذج الكمامة",
                    headcover: "نموذج غطاء الرأس",
                  })[d.model_name] || `نموذج ${d.model_name}`}
                </span>
              </div>
              <span className="conf">{Math.round(d.confidence * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 22 }}>الفئات المُراقَبة</h2>
      <div className="det-list">
        {models.flatMap((m) =>
          (m.categories || []).map((c) => {
            const isActive = activeModels.includes(m.name);
            return (
              <div
                className={`det-item ${isActive ? "" : "muted"}`}
                key={`${m.name}-${c.ar}`}
                style={{
                  borderInlineStartColor: c.color,
                  borderInlineStartWidth: 4,
                  borderInlineStartStyle: "solid",
                }}
              >
                <div className="left">
                  <span className="swatch" style={{ background: c.color }} />
                  <strong>{c.ar}</strong>
                  <span className="conf">
                    ({c.en}) · {m.status_ar}
                  </span>
                </div>
                <span className="conf">{totals?.[c.ar] || 0}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="footer-note">
        النماذج: <code dir="ltr">waste_model.pt</code>،{" "}
        <code dir="ltr">food_model.pt</code>،{" "}
        <code dir="ltr">gloves_model.pt</code>،{" "}
        <code dir="ltr">mask_model.pt</code>،{" "}
        <code dir="ltr">headcover_model.pt</code>
      </div>
    </aside>
  );
}
