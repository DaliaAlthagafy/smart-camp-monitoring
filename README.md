# مراقبة المخيم الذكية · Smart Camp Monitoring

نظام مراقبة للمخيمات يجمع بين واجهة React عربية (RTL) بوضع داكن، وخادم
FastAPI جاهز لاحتضان نموذج YOLO مخصّص لكشف فئتين:

- **النفايات** (`waste`)
- **الطعام** (`food`)

يدعم النظام ثلاث مصادر بث:

1. كاميرا الويب من المتصفح (تعمل محليًا في الجهاز).
2. كاميرات IP / RTSP أو فيديو HTTP.
3. رفع ملف فيديو مسجَّل (mp4/avi/mov…) ومعالجته على الخادم.

> ملاحظة: هذا مشروع مستقل تمامًا ولا يستخدم أو يعدّل SNAM.

---

## البنية

```
smart-camp-monitoring/
├── backend/
│   ├── main.py            # FastAPI app, WebSocket + REST
│   ├── detector.py        # YOLO loader + mock fallback
│   ├── streamer.py        # OpenCV frame producers
│   ├── models/
│   │   └── waste_model.pt # ← ضع نموذجك المدرَّب هنا
│   └── requirements.txt
└── frontend/
    ├── index.html         # dir="rtl" lang="ar"
    └── src/               # React + Vite
```

## تشغيل الخادم (Backend)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

افتح `http://localhost:8000/api/health` للتأكد. سيُظهر الرد ما إذا كان
المُكتشف يعمل بنموذج YOLO أم في وضع المحاكاة.

### تفعيل نموذج YOLO

1. ثبّت الاعتماديات الإضافية:
   ```bash
   pip install ultralytics torch
   ```
2. انسخ ملف الأوزان إلى:
   ```
   backend/models/waste_model.pt
   ```
3. أعد تشغيل الخادم، أو استدعِ:
   ```bash
   curl -X POST http://localhost:8000/api/detector/reload
   ```

يتولّى `detector.py` تحويل أسماء الأصناف الإنجليزية إلى الفئات العربية
(`النفايات` / `الطعام`) عبر القاموس `CLASS_TO_CATEGORY` — عدّله ليطابق
أسماء أصناف نموذجك.

## تشغيل الواجهة (Frontend)

```bash
cd frontend
npm install
npm run dev
```

ثم افتح `http://localhost:5173`. تُستخدم بروكسي Vite لتمرير `/api`
و `/ws` إلى الخادم على المنفذ 8000.

## نقاط النهاية (API)

| الطريقة | المسار | الوصف |
|---------|--------|-------|
| GET   | `/api/health`            | حالة الخادم والمحرّك |
| POST  | `/api/detector/reload`   | إعادة تحميل الأوزان |
| POST  | `/api/detect/frame`      | كشف على إطار واحد (Base64) |
| POST  | `/api/upload`            | رفع ملف فيديو |
| WS    | `/ws/stream`             | بث الإطارات + الاكتشافات |

معاملات WebSocket: `source=synthetic|webcam|rtsp|upload`،
`value=<index|url|upload_id>`، `fps=1..30`.

## الترخيص

استخدام داخلي للمشروع.
