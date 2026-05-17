import React from "react";

/**
 * Operational stats panel.
 *
 * Renders three primary modules (Waste, Food Safety, Worker Hygiene) as
 * top-level cards. The Worker Hygiene module folds all six hygiene
 * categories into a single card with a compliance ratio, total
 * violations, and a compact KPI strip — there are no standalone cards
 * for قفازات / بدون قفازات / etc. by design.
 */

const HYGIENE_MODELS = ["gloves", "mask", "headcover"];

const OK_CATEGORIES = ["قفازات", "كمامة", "غطاء رأس"];
const VIOLATION_CATEGORIES = ["بدون قفازات", "بدون كمامة", "بدون غطاء رأس"];

// Food safety (3-class) — fresh ↔ at_risk ↔ rotten map to severities
// the same way hygiene does, so the visual logic stays consistent.
const FOOD_OK_CATEGORIES        = ["صالح"];
const FOOD_WARN_CATEGORIES      = ["يحتاج فحص"];
const FOOD_VIOLATION_CATEGORIES = ["متعفن"];

function severityForCompliance(pct) {
  if (pct === null) return "neutral";
  if (pct >= 95) return "ok";
  if (pct >= 70) return "warn";
  return "violation";
}

function severityForFood({ fresh, atRisk, rotten }) {
  if (rotten > 0) return "violation";
  if (atRisk > 0) return "warn";
  if (fresh  > 0) return "ok";
  return "neutral";
}

function severityLabel(sev) {
  switch (sev) {
    case "ok":        return "ضمن المعدلات الآمنة";
    case "warn":      return "تنبيه — يحتاج مراجعة";
    case "violation": return "خرق متعدد — تدخّل عاجل";
    default:          return "في انتظار البيانات";
  }
}

function ModuleHead({ icon, title, active, statusBadge }) {
  return (
    <div className="module-head">
      <span className="module-icon">{icon}</span>
      <h3>{title}</h3>
      <span className={`module-status ${active ? "on" : "off"}`}>
        {statusBadge}
      </span>
    </div>
  );
}

function WasteModule({ totals, activeModels, models }) {
  const active = activeModels.includes("waste");
  const m = models.find((x) => x.name === "waste");
  const count = totals["النفايات"] || 0;
  return (
    <div className={`module-card waste ${active ? "" : "inactive"}`}>
      <ModuleHead
        icon="🗑️"
        title="مراقبة النفايات"
        active={active}
        statusBadge={active ? `نشط · ${m?.status_ar || ""}` : "غير نشط"}
      />
      <div className="module-primary">
        <div className="primary-value" style={{ color: "#ff5436" }}>{count}</div>
        <div className="primary-label">اكتشاف نفايات منذ بدء الجلسة</div>
      </div>
      <div className="module-footer">
        أحد المؤشرات الرئيسية لمدى نظافة المنطقة المراقَبة.
      </div>
    </div>
  );
}

function FoodModule({ totals, activeModels, models }) {
  const active = activeModels.includes("food");
  const m = models.find((x) => x.name === "food");

  const fresh   = totals["صالح"]        || 0;
  const atRisk  = totals["يحتاج فحص"]   || 0;
  const rotten  = totals["متعفن"]       || 0;
  const total   = fresh + atRisk + rotten;
  const safePct = total > 0 ? Math.round((fresh / total) * 100) : null;
  const sev     = severityForFood({ fresh, atRisk, rotten });

  const badge =
    !m?.available ? "غير متوفر" :
    active        ? `نشط · ${m?.status_ar || ""}` : "غير نشط";

  return (
    <div className={`module-card food sev-${sev} ${active && m?.available ? "" : "inactive"}`}>
      <ModuleHead
        icon="🍽️"
        title="سلامة الغذاء"
        active={active && m?.available}
        statusBadge={badge}
      />

      <div className="hygiene-main">
        <div className="hygiene-tile compliance">
          <div className="tile-label">نسبة الصلاحية</div>
          <div className="tile-value">
            {safePct === null ? "—" : `${safePct}%`}
          </div>
          <div className="compliance-bar">
            <div className="compliance-fill" style={{ width: `${safePct ?? 0}%` }} />
          </div>
        </div>
        <div className="hygiene-tile violations">
          <div className="tile-label">عناصر متعفنة</div>
          <div className="tile-value">{rotten}</div>
          <div className="tile-sub">
            {sev === "violation" ? "تنبيه — يحتاج إزالة فورية" :
             sev === "warn"      ? "بنود تحتاج فحصًا" :
             sev === "ok"        ? "ضمن الحدود الآمنة" : "في انتظار البيانات"}
          </div>
        </div>
      </div>

      <div className="hygiene-kpis food-kpis">
        <div className="kpi kpi-ok">
          <span className="kpi-label">صالح</span>
          <span className="kpi-value">{fresh}</span>
        </div>
        <div className="kpi kpi-warn">
          <span className="kpi-label">يحتاج فحص</span>
          <span className="kpi-value">{atRisk}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">متعفن</span>
          <span className="kpi-value">{rotten}</span>
        </div>
      </div>

      <div className="module-footer">
        {m?.available
          ? "ثلاث فئات: صالح (أخضر) / يحتاج فحص (برتقالي) / متعفن (أحمر)."
          : "في انتظار رفع نموذج سلامة الغذاء."}
      </div>
    </div>
  );
}

function HygieneModule({ totals, activeModels, models }) {
  const hygieneActive = HYGIENE_MODELS.filter((n) => activeModels.includes(n));
  const allActive  = hygieneActive.length === HYGIENE_MODELS.length;
  const someActive = hygieneActive.length > 0;

  const ok = OK_CATEGORIES.reduce((s, c) => s + (totals[c] || 0), 0);
  const violations = VIOLATION_CATEGORIES.reduce((s, c) => s + (totals[c] || 0), 0);
  const total = ok + violations;
  const compliance = total > 0 ? Math.round((ok / total) * 100) : null;
  const sev = severityForCompliance(compliance);

  const badge =
    !someActive ? "غير نشط" :
    allActive   ? "نشط بالكامل" :
                  `نشط جزئيًا (${hygieneActive.length}/3)`;

  return (
    <div className={`module-card hygiene sev-${sev} ${someActive ? "" : "inactive"}`}>
      <ModuleHead
        icon="🧤"
        title="الالتزام الصحي للعاملين"
        active={someActive}
        statusBadge={badge}
      />

      <div className="hygiene-main">
        <div className="hygiene-tile compliance">
          <div className="tile-label">نسبة الالتزام</div>
          <div className="tile-value" style={{ color: "currentColor" }}>
            {compliance === null ? "—" : `${compliance}%`}
          </div>
          <div className="compliance-bar">
            <div
              className="compliance-fill"
              style={{ width: `${compliance ?? 0}%` }}
            />
          </div>
        </div>
        <div className="hygiene-tile violations">
          <div className="tile-label">عدد المخالفات</div>
          <div className="tile-value">{violations}</div>
          <div className="tile-sub">{severityLabel(sev)}</div>
        </div>
      </div>

      <div className="hygiene-kpis">
        <div className="kpi">
          <span className="kpi-label">بدون قفازات</span>
          <span className="kpi-value">{totals["بدون قفازات"] || 0}</span>
          <span className="kpi-status">{statusFor("gloves", models, activeModels)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">بدون كمامة</span>
          <span className="kpi-value">{totals["بدون كمامة"] || 0}</span>
          <span className="kpi-status">{statusFor("mask", models, activeModels)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">بدون غطاء رأس</span>
          <span className="kpi-value">{totals["بدون غطاء رأس"] || 0}</span>
          <span className="kpi-status">{statusFor("headcover", models, activeModels)}</span>
        </div>
      </div>

      <div className="module-footer hygiene-foot">
        مؤشر مجمَّع لقفازات / كمامة / غطاء رأس — التفاصيل تظهر فقط على
        البث المباشر.
      </div>
    </div>
  );
}

function statusFor(modelName, models, activeModels) {
  const m = models.find((x) => x.name === modelName);
  if (!m) return "—";
  if (!m.available) return "غير متوفر";
  if (!activeModels.includes(modelName)) return "موقَف";
  return m.status_ar;
}

export default function StatsPanel({
  totals = {},
  activeModels = [],
  models = [],
  engine,
}) {
  return (
    <aside className="card stats-panel">
      <div className="stats-header">
        <h2>الإحصائيات التشغيلية</h2>
        <span className={`engine-mini ${engine === "YOLO" ? "ok" : engine === "NONE" ? "off" : "warn"}`}>
          {engine === "YOLO" ? "YOLO فعلي"
            : engine === "NONE" ? "لا يوجد نموذج"
            : "محاكاة"}
        </span>
      </div>

      <WasteModule    totals={totals} activeModels={activeModels} models={models} />
      <FoodModule     totals={totals} activeModels={activeModels} models={models} />
      <HygieneModule  totals={totals} activeModels={activeModels} models={models} />
    </aside>
  );
}
