# Amica Unity Avatar Conversion Lane

This note is for avatar or animation packs that are not directly usable by Amica yet.

Use this lane when a downloaded asset is one of:

- `.unitypackage`
- `.fbx`
- Unity prefab/material/texture bundle
- VRChat-oriented avatar or animation package
- mixed archive containing FBX, textures, materials, or Unity metadata

## Direct Amica Inputs

Amica can use:

- `.vrm` avatar files
- `.vrma` animation files

If you already have `.vrma`, use the local animation intake workflow instead.

## Conversion Inputs

FBX or UnityPackage assets are not automatically usable by Amica. They need inspection/conversion first.

Typical path:

```text
UnityPackage / FBX bundle
→ inspect contents
→ import into Unity if needed
→ export/convert to VRM or VRMA
→ copy final .vrm/.vrma into Amica public assets
→ regenerate src/paths.ts
```

## Boundary

Do not commit private avatar files, downloaded commercial assets, or generated private model paths into `src/paths.ts`.

Keep private/local avatar assets out of normal committed app paths unless intentionally publishing them.
