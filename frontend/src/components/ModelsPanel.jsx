import React, { useState } from "react";

/* ---------------------------------------------------------------------
 * Three logical groups the user can toggle. Each group maps to one or
 * more backend model names that the registry exposes.
 * ------------------------------------------------------------------- */
const GROUPS = [
  { id: "waste",   label: "النفايات",        models: ["waste"] },
  { id: "food",    label: "سلامة الغذاء",    models: ["food"]  },
  { id: "hygiene", label: "التزام العاملين", models: ["gloves", "mask", "headcover"] },
];

const ALL_MODELS = GROUPS.flatMap((g) => g.models);

/* The three "groups" are *all* selected if every one of their models is
 * present in activeModels. */
function isGroupChecked(group, activeModels) {
  return group.models.every((m) => activeModels.includes(m));
}

export default function ModelsPanel({ models, activeModels, onChange }) {
  const byName = Object.fromEntries((models || []).map((m) => [m.name, m]));
  const [warning, setWarning] = useState("");

  // Helper: compute the merged active list when a group is toggled.
  function toggleGroup(group, checked) {
    let next;
    if (checked) {
      // Add the group's models (dedup, preserving order).
      const set = new Set(activeModels);
      group.models.forEach((m) => set.add(m));
      next = ALL_MODELS.filter((m) => set.has(m));
    } else {
      next = activeModels.filter((m) => !group.models.includes(m));
    }
    if (next.length === 0) {
      flashWarning("يجب اختيار نموذج واحد على الأقل");
      return;
    }
    clearWarning();
    onChange(next);
  }

  function selectAll() {
    clearWarning();
    onChange([...ALL_MODELS]);
  }
  function clearAll() {
    flashWarning("يجب اختيار نموذج واحد على الأقل");
  }
  function flashWarning(msg) {
    setWarning(msg);
    setTimeout(() => setWarning((w) => (w === msg ? "" : w)), 3500);
  }
  function clearWarning() {
    setWarning("");
  }

  return (
    <aside className="card">
      <h2>نماذج التحليل</h2>

      <div className="select-controls">
        <button className="btn small" onClick={selectAll}>تحديد الكل</button>
        <button className="btn small ghost" onClick={clearAll}>إلغاء الكل</button>
      </div>

      <div className="checkbox-group">
        {GROUPS.map((group) => {
          const checked = isGroupChecked(group, activeModels);
          // Group is "available" if at least one of its models is loadable.
          const available = group.models.some((m) => byName[m]?.available);
          // Mixed availability: some of the underlying models are unavailable
          // (relevant only for the hygiene group with 3 sub-models).
          const total = group.models.length;
          const ready = group.models.filter((m) => byName[m]?.available).length;
          const isHygiene = group.id === "hygiene";

          return (
            <label
              key={group.id}
              className={`checkbox-row ${checked ? "on" : ""} ${!available ? "disabled" : ""}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!available}
                onChange={(e) => toggleGroup(group, e.target.checked)}
              />
              <span className="checkbox-box" aria-hidden="true" />
              <span className="checkbox-label">
                <strong>{group.label}</strong>
                {isHygiene && (
                  <span className="checkbox-sub">
                    {ready}/{total} نماذج جاهزة
                  </span>
                )}
                {!available && (
                  <span className="checkbox-sub off">غير متوفر</span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      {warning && <div className="inline-warning">{warning}</div>}

      <div className="footer-note">
        يمكن تبديل النماذج أثناء التشغيل دون إعادة تشغيل الخادم —
        يُحدَّث الاستدلال على الفور لكل إطار قادم.
      </div>
    </aside>
  );
}
