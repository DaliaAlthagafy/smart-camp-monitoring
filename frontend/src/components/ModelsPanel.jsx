import React from "react";

const HYGIENE = ["gloves", "mask", "headcover"];
const ALL     = ["waste", "food", "gloves", "mask", "headcover"];

const MODES = [
  { key: "waste",     label: "تشغيل نموذج النفايات فقط",   models: ["waste"] },
  { key: "food",      label: "تشغيل نموذج الطعام فقط",     models: ["food"]  },
  { key: "ws_pair",   label: "تشغيل النفايات + الطعام",     models: ["waste", "food"] },
  { key: "hygiene",   label: "تشغيل نماذج التزام العاملين", models: HYGIENE },
  { key: "all",       label: "تشغيل الكل",                  models: ALL },
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
function setEq(a, b) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

export default function ModelsPanel({ models, activeModels, onChange }) {
  const byName = Object.fromEntries((models || []).map((m) => [m.name, m]));
  const isAvailable = (n) => byName[n]?.available;

  // Determine which named mode (if any) the current selection matches.
  const currentMode = MODES.find((m) => setEq(m.models, activeModels))?.key || "";

  const toggleSingle = (name) => {
    if (activeModels.includes(name)) {
      const next = activeModels.filter((m) => m !== name);
      onChange(next.length ? next : [name]); // never leave the registry empty
    } else {
      onChange([...activeModels, name]);
    }
  };

  // Order matches the user's mental model: waste/food first, then hygiene.
  const renderModels = ["waste", "food", "gloves", "mask", "headcover"]
    .map((n) => byName[n])
    .filter(Boolean);

  return (
    <aside className="card">
      <h2>نماذج التحليل</h2>

      <div className="source-group">
        {MODES.map((m) => {
          const someAvailable = m.models.some(isAvailable);
          const active = currentMode === m.key;
          return (
            <button
              key={m.key}
              className={`source-btn ${active ? "active" : ""}`}
              onClick={() => onChange(m.models)}
              disabled={!someAvailable}
              title={
                !someAvailable
                  ? "كل النماذج المطلوبة لهذا الوضع غير متوفرة"
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

      <h2 style={{ marginTop: 18 }}>الموديلات</h2>
      <div className="det-list">
        {renderModels.map((m) => {
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

              {/* List of categories this model can emit */}
              {m.categories?.length > 0 && (
                <div className="model-cats">
                  {m.categories.map((c) => (
                    <span
                      key={c.ar}
                      className={`cat-pill sev-${c.severity || "info"}`}
                      style={{ borderColor: c.color, color: c.color }}
                    >
                      {c.ar}
                    </span>
                  ))}
                </div>
              )}

              {!m.available && (
                <div className="model-row-note">
                  نموذج {m.display_ar} غير متوفر حاليًا
                  {m.is_lfs_pointer
                    ? " — نفّذ git lfs pull لاسترجاع الأوزان."
                    : !m.model_present
                    ? ` — أضف الملف باسم ${m.name}_model.pt`
                       + (m.legacy_names?.length
                          ? ` (أو الاسم المحلي القديم: ${m.legacy_names.join("، ")})`
                          : "") + "."
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
