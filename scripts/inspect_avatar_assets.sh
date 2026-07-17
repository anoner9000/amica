#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-/mnt/c/Users/Skyler/Documents/VR Assets/Animations}"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Error: target directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

declare -a vrma_files=()
declare -a fbx_files=()
declare -a anim_files=()
declare -a unitypackage_files=()
declare -a controller_files=()
declare -a prefab_files=()
declare -a mat_files=()
declare -a texture_files=()

while IFS= read -r -d '' file; do
  lower="${file,,}"
  case "$lower" in
    *.vrma) vrma_files+=("$file") ;;
    *.fbx) fbx_files+=("$file") ;;
    *.anim) anim_files+=("$file") ;;
    *.unitypackage) unitypackage_files+=("$file") ;;
    *.controller) controller_files+=("$file") ;;
    *.prefab) prefab_files+=("$file") ;;
    *.mat) mat_files+=("$file") ;;
    *.png|*.jpg|*.jpeg|*.psd) texture_files+=("$file") ;;
  esac
done < <(find "$TARGET_DIR" -type f -print0)

print_sorted_list() {
  local heading="$1"
  shift
  local -a items=("$@")
  echo "$heading"
  if [[ ${#items[@]} -eq 0 ]]; then
    echo "  (none)"
    return
  fi
  printf '%s\n' "${items[@]}" | LC_ALL=C sort | sed 's/^/  /'
}

echo "Target directory: $TARGET_DIR"
echo
echo "Summary counts:"
printf '  .vrma: %d\n' "${#vrma_files[@]}"
printf '  .fbx: %d\n' "${#fbx_files[@]}"
printf '  .anim: %d\n' "${#anim_files[@]}"
printf '  .controller: %d\n' "${#controller_files[@]}"
printf '  .unitypackage: %d\n' "${#unitypackage_files[@]}"
printf '  .prefab: %d\n' "${#prefab_files[@]}"
printf '  texture-ish (.png .jpg .jpeg .psd): %d\n' "${#texture_files[@]}"
printf '  .mat: %d\n' "${#mat_files[@]}"
echo

print_sorted_list "DIRECT_AMICA_ANIMATIONS: .vrma" "${vrma_files[@]}"
echo
print_sorted_list "POSSIBLE_CONVERSION_INPUTS: .fbx .anim .unitypackage" \
  "${fbx_files[@]}" \
  "${anim_files[@]}" \
  "${unitypackage_files[@]}"
echo
print_sorted_list "UNITY_ONLY_OR_SUPPORTING_ASSETS: .controller .prefab .mat .png .jpg .jpeg .psd" \
  "${controller_files[@]}" \
  "${prefab_files[@]}" \
  "${mat_files[@]}" \
  "${texture_files[@]}"
