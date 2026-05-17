# Models

Place your trained YOLO weights here as `waste_model.pt`.

When the file is present and `ultralytics` is installed, the backend
detector switches from mock detections to real inference automatically
on startup (or via `POST /api/detector/reload`).

Expected class names (case-insensitive) mapped to monitored categories:

| Class name          | Category (Arabic) |
|---------------------|-------------------|
| waste / trash / garbage / bottle / plastic | النفايات |
| food / meal / tray / plate                  | الطعام    |

Add or rename classes by editing `CLASS_TO_CATEGORY` in `backend/detector.py`.
