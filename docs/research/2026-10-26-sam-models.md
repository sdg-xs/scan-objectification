# SAM models and existing-scan selection

Research checked 2026-10-26 against Meta's official repositories and API documentation. This note proposes no implementation or dependency changes.

## Verified developments

**SAM 3.1:** released March 27, 2026. Its headline change, Object Multiplex, jointly processes groups of tracked objects to reduce redundant work in video tracking. Meta reports approximately 7× speedup at 128 objects on one H100 versus the November 2025 SAM 3 release. This benchmark does not establish single-object latency or performance on an RTX 4070 Laptop GPU. [Release notes](https://github.com/facebookresearch/sam3/blob/main/RELEASE_SAM3p1.md)

**Hosted segmentation:** Meta documents `sam-3.1` on its Model API for images and video, using text, box, or point prompts and returning boxes and pixel masks. This offers an alternative to hosting inference locally, but requires an external service and sending image/video input. It does not itself return membership in an existing Gaussian scene. [API overview](https://dev.meta.ai/docs/sam/overview)

**SAM 3D Objects:** this is single-image reconstruction: an image plus object mask produces reconstructed shape, texture, pose, and layout. The official example exports a Gaussian PLY. Checkpoints launched November 19, 2025; encoder weights followed June 1, 2026, and the artist-object dataset and leaderboard June 2. SAM 3D Body is the separate human-mesh model. [Official repository](https://github.com/facebookresearch/sam-3d-objects)

**SAM 3D local requirements:** official setup specifies Linux 64-bit and an NVIDIA GPU with at least 32 GB VRAM. Those are published prerequisites, not a claim that every optimized derivative needs 32 GB. [Setup](https://github.com/facebookresearch/sam-3d-objects/blob/main/doc/setup.md)

## Recommendation and limits

**Engineering inference:** keep Three.js/Spark as the existing-scene viewer. For the next milestone—selecting and isolating one object already present in a scan—evaluate prompted 2D segmentation first. Its masks still need projection into the scene, visibility/occlusion handling, and stable source IDs so an isolated result contains the intended original splats across viewpoints.

SAM 3D addresses generating a new object from an image. Its reconstruction is not evidence of measured scan fidelity, verified dimensions, or parametric CAD/IFC output; it should be a separate experiment rather than the selection milestone's dependency. This distinction follows from its documented image-to-reconstruction workflow, not a claim that Meta forbids other uses. [Workflow and export example](https://github.com/facebookresearch/sam-3d-objects#single-or-multi-object-3d-generation)

The parent session measured a Windows host with an RTX 4070 Laptop GPU and 8 GB VRAM, and found no Torch/SAM packages in the app venv. Native SAM 3.1 fit, latency, and coexistence with the viewer on this host remain unproven. Do not extrapolate the H100 benchmark or treat SAM 3D's Linux/32 GB prerequisites as SAM 3.1 requirements.
