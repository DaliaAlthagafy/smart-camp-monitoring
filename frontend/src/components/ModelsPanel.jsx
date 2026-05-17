import React from "react";

const MODES = [
  { key: "waste",       label: "تشغيل نموذج النفايات فقط", models: ["waste"]         },
  { key: "food",        label: "تشغيل نموذج الطعام فقط",   models: ["food"]          },
  { key: "both",        label: "تشغيل النموذجين معًا",     models: ["waste", "food"] },
];

function statusClass(mode) {
  if (mode === "yolo") return "ok";
  if (mode === "mock") return "warn";
  return "off";
}

function statusBadge(mode) {
  if (mode === "yolo") return "YOLO فعلي";
  if (mode === "mock") return "Mock";
  return "غير متوفر";
}

function arrayEq(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(), sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

export default function ModelsPanel({ models, activeModels, onChange }) {
  const byName = Object.fromEntries((models || []).map((m) => [m.name, m]));
  const waste = byName.waste;
  const food  = byName.food;

  // Hide modes whose required models are all unavailable.
  const isAvailable = (m) => byName[m]?.available;

  const currentModeKey =
    activeModels.length === 1 && activeModels[0] === "waste" ? "waste" :
    activeModels.length === 1 && activeModels[0] === "food"  ? "food"  :
    activeModels.length === 2 && activeModels.includes("waste") && activeModels.includes("food") ? "both" :
    "";

  const toggleSingle = (name) => {
    if (activeModels.includes(name)) {
      const next = activeModels.filter((m) => m !== name);
      onChange(next.length ? next : [name]); // never zero — keep at least the toggled one
    } else {
      onChange([...activeModels, name]);
    }
  };

  return (
    <aside className="card">
      <h2>نماذج التحليل</h2>

      <div className="source-group">
        {MODES.map((m) => {
          const enabled = m.models.every(isAvailable);
          const active  = currentModeKey === m.key;
          return (
            <button
              key={m.key}
              className={`source-btn ${active ? "active" : ""}`}
              onClick={() => onChange(m.models)}
              disabled={!enabled}
              title={
                !enabled
                  ? "بعض النماذج المطلوبة غير متوفرة"
                  : ""
              }
            >
              <span>{m.label}</span>
              <span className="badge">
                {m.models.map((x) => byName[x]?.display_ar || x).join(" + ")}
              </span>
            </button>
          );
        })}
      </div>

      <h2 style={{ marginTop: 18 }}>الفئات</h2>
      <div className="det-list">
        {[waste, food].filter(Boolean).map((m) => {
          const isActive = activeModels.includes(m.name);
          return (
            <div
              className={`model-row ${isActive ? "on" : "off"}`}
              key={m.name}
              style={{ borderInlineStartColor: m.color }}
            >
              <div className="model-row-main">
                <button
                  className={`model-toggle ${isActive ? "on" : "off"}`}
                  onClick={() => toggleSingle(m.name)}
                  disabled={!m.available}
                  aria-pressed={isActive}
                  title={
                    !m.available
                      ? `نموذج ${m.display_ar} غير متوفر حاليًا`
                      : isActive ? "تعطيل" : "تفعيل"
                  }
                  style={{ borderColor: m.color }}
                >
                  <span className="swatch" style={{ background: m.color }} />
                  <strong>{m.display_ar}</strong>
                  <span className="conf">({m.display_en})</span>
                </button>
                <span className={`status-tag ${statusClass(m.mode)}`}>
                  {isActive && m.available ? "نشط · " : ""}{statusBadge(m.mode)}
                </span>
              </div>
              {!m.available && (
                <div className="model-row-note">
                  نموذج {m.display_ar} غير متوفر حاليًا
                  {m.is_lfs_pointer
                    ? " — نفّذ git lfs pull لاسترجاع الأوزان."
                    : !m.model_present
                    ? ` — أضف الملف على ${m.name}_model.pt لتفعيله.`
                    : "."}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="footer-note">
        يمكن تبديل النماذج أثناء التشغيل دون إعادة تشغيل الخادم —
        يُحدَّث الاستدلال على الفور لكل إطار قادم.
      </div>
    </aside>
  );
}
