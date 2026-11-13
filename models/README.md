# Bundled detection models

| File | Model | Source | License |
|---|---|---|---|
| `yolox_tiny.onnx` | YOLOX-Tiny, 416 px | YOLOX project (Megvii), release 0.1.1rc0 | Apache-2.0 |
| `yolo26n.onnx` | YOLO26n, 640 px, end-to-end output `[1, 300, 6]` | Ultralytics | **AGPL-3.0** |
| `yolo26s.onnx` | YOLO26s, 640 px, end-to-end output `[1, 300, 6]` | Ultralytics | **AGPL-3.0** |

The YOLO26 files were exported unchanged from the official Ultralytics checkpoints
(`yolo26n.pt`, `yolo26s.pt` from the Ultralytics assets release v8.4.0 on GitHub) with
Ultralytics 8.4.212:

```python
from ultralytics import YOLO
YOLO("yolo26n.pt").export(format="onnx", imgsz=640, opset=17, nms=False)
```

**License note.** The YOLO26 weights are licensed under AGPL-3.0 (or a commercial license from
Ultralytics). If you redistribute this package or a Docker image with these two files, the AGPL
terms apply to that distribution. To avoid that, delete `yolo26n.onnx` and `yolo26s.onnx` –
Kestrel works without them and simply does not list them. Users can still export a model
themselves and upload it under *Settings → Detection*.
