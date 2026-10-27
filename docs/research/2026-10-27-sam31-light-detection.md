# SAM 3.1 for identifying lights in the current viewer

Checked 2026-10-27 against Meta's current documentation and source. This is research and an integration recommendation; no inference was run and no detection accuracy is established.

## What 3.1 actually changes

SAM 3.1 was released March 27, 2026. Its documented improvement is Object Multiplex: shared processing of multiple tracked objects in video, with associated inference optimizations. Meta's roughly 7× result concerns 128 objects on an H100. The release reports video benchmarks, including mixed concept-segmentation results; it does not establish better single-image light detection or laptop latency. [Official release notes](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md)

The checkpoint repository is `facebook/sam3.1`, gated behind Hugging Face login and agreement to share account information. Its model card says it hosts checkpoints without Transformers integration. [Meta model card](https://huggingface.co/facebook/sam3.1)

**Version trap:** the current `build_sam3_image_model()` automatically downloads `facebook/sam3/sam3.pt`. The 3.1 checkpoint is `facebook/sam3.1/sam3.1_multiplex.pt`; the explicitly documented 3.1 entry is `build_sam3_predictor(version="sam3.1")`, a video predictor. A standard image-processor example is therefore a SAM 3 image baseline, not proof of running SAM 3.1. Loading an explicitly selected 3.1 checkpoint into the image builder needs a separate compatibility and output check; no dedicated 3.1 image constructor was found. [Builder source](https://github.com/facebookresearch/sam3/blob/main/sam3/model_builder.py)

## First experiment

Engineering recommendation: capture the current Three.js/Spark canvas as an image, retain the exact image width/height and camera pose, then segment that frozen frame. Overlay each returned mask and box on the same frame. Start with separate concepts:

| Target | Candidate prompts to compare separately |
| --- | --- |
| Linear fixture | `linear light fixture`, `strip light`, `fluorescent light` |
| Round ceiling fixture | `round ceiling light`, `recessed ceiling light`, `downlight` |
| Visible bulb | `light bulb` |

These are proposed prompts, not a verified vocabulary or measured result. Use the noun matching the visible object: an enclosed round fixture may not expose a bulb. Compare synonyms against manually counted fixtures, recording false positives and misses. Do not combine both categories into one phrase. Meta recommends one short concrete noun phrase per call and supports box/point prompts when an object is already located. [Prompt guide](https://dev.meta.ai/docs/sam/segmenting)

A successful overlay establishes 2D identification only. Mapping masks into the existing scan requires a separate visible-splat membership/projection step, occlusion handling, and multi-view validation. It does not automatically isolate all original 3D splats of a light.

Repository/host observations from the parent agent's inspection on this date: the GPU is an RTX 4070 Laptop with 8188 MiB VRAM and driver 610.78; the app environment is Python 3.12.14 without Torch, SAM, Transformers, or Pillow. The viewer API is active on 8767 and nothing is listening on 8766. The reference `Source Code/nemy.asset_metadata_property-0.5.0/tools/mask_service/sam3_service.py` uses Transformers `Sam3Model`/`Sam3Processor` with base SAM 3, not a verified 3.1 implementation. Its surrounding service rejects any Origin header, limits PNGs to 2048 pixels per side / four million pixels, and caps results at 50 instances. These are local observations, not Meta's published requirements.

Practical local proposal: browser → same-origin API on 8767 → separately isolated local inference process. Reuse or adapt the existing service only after a clean inference smoke test confirms its model/version and returned masks; a successful base SAM 3 response must retain that label. Return packed per-instance masks, counts, and source dimensions for review on a frozen clean scan capture. A direct browser call to 8766 conflicts with the existing service's Origin rejection. The capture should exclude viewer controls and overlays; verify alignment using the exact captured raster dimensions before trusting detections.

## Hosted SAM 3.1: documented still-image path

Meta explicitly documents `sam-3.1` for stills and clips at **`POST https://api.meta.ai/v1/responses`**, authenticated by `Authorization: Bearer <MODEL_API_KEY>`. Send one user message containing `input_text` and `input_image`. Non-streaming is supported. Outputs use special-token text carrying boxes and masks; they are not ordinary JSON detection records. The official parser can decode binary masks, and zero matches is valid. [SAM API overview](https://dev.meta.ai/docs/sam/overview)

Suggested server-side request body, following that schema:

```json
{
  "model": "sam-3.1",
  "input": [{
    "type": "message",
    "role": "user",
    "content": [
      {"type": "input_text", "text": "linear light fixture"},
      {"type": "input_image", "image_url": "data:image/png;base64,<CAPTURE>"}
    ]
  }],
  "stream": false,
  "metadata": {"mask_encoding": "one_bit"}
}
```

The official cookbook demonstrates local-image data URLs and the `meta_sam_parser` Python / `@meta-sam/parser` TypeScript parsers. Copy its validated decoding flow rather than treating the response text as JSON or hand-writing the mask codec. [Cookbook and linked source](https://dev.meta.ai/docs/cookbook/sam-api-basics)

Engineering recommendation: keep the provider key on the local server and return normalized boxes, masks, and image dimensions to the browser. Use a backend adapter or separate experiment service; this hosted path uploads scene imagery externally and changes the pilot's local-only architecture. It needs a deliberate scope decision. No authenticated request was made, and account/model access remains unverified. Meta requires eligible signup, billing, and an API key. [Signup requirements](https://dev.meta.ai/help/accounts-and-login/sign-up)

## Local deployment and known constraints

The repository's published prerequisites are Python ≥3.12, PyTorch ≥2.7, and a CUDA-compatible GPU with CUDA ≥12.6. Its current example installs Torch 2.10.0 from the CUDA 12.8 wheel index. Use a separate environment and record the tested repository commit. The README does not publish a Windows support guarantee, minimum VRAM, or measured RTX 4070 Laptop image latency. Native Windows success, 8 GB fit, and coexistence with the viewer remain unknown; a Linux/WSL2 experiment is an engineering fallback, not an official requirement. [Installation](https://github.com/facebookresearch/sam3#installation)

Isolation matters: SAM's package currently requires `numpy>=1.26,<2`, incompatible with this app's fixed `numpy==2.5.4`. Its package metadata's broad Python floor also differs from the README prerequisites; follow the documented installation baseline instead of interpreting metadata as proof of supported older versions. [Package metadata](https://github.com/facebookresearch/sam3/blob/main/pyproject.toml)

The documented local image baseline is:

```python
from PIL import Image
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

model = build_sam3_image_model()  # SAM 3 default checkpoint, NOT 3.1
processor = Sam3Processor(model)
state = processor.set_image(Image.open("viewer-capture.png").convert("RGB"))
result = processor.set_text_prompt(state=state, prompt="linear light fixture")
masks, boxes, scores = result["masks"], result["boxes"], result["scores"]
```

[Official image example](https://github.com/facebookresearch/sam3#basic-usage). The processor defaults to a 1008-pixel square input and confidence threshold 0.5; it preserves original dimensions for output processing. Thin/distant lights and threshold changes should be evaluated on actual captures rather than assumed reliable. [Processor source](https://github.com/facebookresearch/sam3/blob/main/sam3/model/sam3_image_processor.py)

The governing repository license is the custom **SAM License**, not a generic MIT assumption from package classifiers. Read it before distributing models or derivatives; gated checkpoint access is a separate prerequisite. [License](https://github.com/facebookresearch/sam3/blob/main/LICENSE)

No official minimum-VRAM claim or measured result for this host was located in these sources. SAM 3D's separate 32 GB requirement must not be applied to SAM 3.1. For the requested first milestone, a documented hosted 3.1 still-image call is the clearest exact-version experiment if external processing is accepted; otherwise establish a local SAM 3 image baseline and explicitly validate any subsequent 3.1 local path.

## Local inference check — 2026-10-27

The separate `.venv-sam31` environment now runs the actual `facebook/sam3.1/sam3.1_multiplex.pt` checkpoint on the RTX 4070 Laptop GPU. Source revision: `f1647e8d0c1d280991f4d1b7d974c2704537fe66`. Application dependency pins were not changed. The local environment snapshot is `data/sam31/environment.txt`; the experiment runner is `data/sam31/run_lights.py`. These runtime artifacts and model weights are gitignored.

The first inference attempt failed at `start_session`: the shared wrapper unconditionally passed `offload_state_to_cpu`, but the multiplex model's `init_state` does not accept it. The isolated source checkout was patched to omit that argument. The saved patch is `data/sam31/session-wrapper.patch`. This does not establish support for CPU state offload; only video-frame offload remains requested. The same inference command then exited 0 and wrote masks, overlays, and JSON outputs.

The smoke input was a generated uniform 512 × 512 image, not the user's ceiling view. Separate prompts `linear light fixture`, `round ceiling light`, and `light bulb` all completed and returned zero detections. This proves the inference path runs, not that it detects real lights accurately. Existing upstream checkpoint-loading warnings remain; no claim of numerical equivalence to Meta's reference results is made.

Run against a user-supplied ceiling image from the repository root:

```powershell
.\.venv-sam31\Scripts\python.exe -u data/sam31/run_lights.py test_files/ceiling.png --output data/sam31/ceiling-results
```

The user's ceiling view has not been inspected by the agent. The browser origin gate continues to reject `http://localhost:5173` even after the desktop UI was verified to show an explicit Always allow rule. No alternate browser-control path was used to bypass that denial.

## In-app integration — 2026-10-27

The viewer now captures its own rendered view when the user clicks **Find lights in this view**. A same-origin FastAPI gateway on 8767 forwards the bounded PNG to an automatically started local worker on 8768. The worker uses direct multiplex `init_state` / `add_prompt` calls, avoiding the session-wrapper mismatch without requiring the experimental source patch. It returns combined masks/boxes and per-category detections for a frozen in-app image, with no 3D extraction.

A real request through this gateway completed on the generated 512×512 blank image and returned `sam3.1`, matching dimensions, three empty groups and a valid annotated PNG. This verifies the full inference transport path, not real-scene accuracy. The user can test the ceiling view directly in the app; an externally supplied screenshot is no longer required for that workflow.
