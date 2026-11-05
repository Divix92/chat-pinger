#!/usr/bin/env bash
# Local, non-root Debian toolchain for the managed cloud workspace.
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
toolchain_dir=/workspace/toolchain
apt_dir=/workspace/.chat-pinger-apt
mkdir -p "$apt_dir/lists/partial" "$apt_dir/archives/partial" "$apt_dir/config" "$toolchain_dir"
cat > "$apt_dir/apt.conf" <<CONFIG
Dir::Etc::Parts "$apt_dir/config";
Dir::Etc::sourcelist "$apt_dir/sources.list";
Dir::Etc::sourceparts "$apt_dir/config";
Dir::State::lists "$apt_dir/lists";
Dir::Cache::archives "$apt_dir/archives";
Debug::NoLocking "true";
APT::Update::Error-Mode "any";
CONFIG
cat > "$apt_dir/sources.list" <<'SOURCES'
deb https://deb.debian.org/debian trixie main
SOURCES
APT_CONFIG="$apt_dir/apt.conf" /usr/bin/apt-get update
APT_CONFIG="$apt_dir/apt.conf" /usr/bin/apt-get --download-only --no-install-recommends -y install cmake ninja-build libobs-dev obs-studio qt6-base-dev qt6-websockets-dev xvfb xauth
for archive in "$apt_dir"/archives/*.deb; do dpkg-deb -x "$archive" "$toolchain_dir"; done
# Development packages refer to runtime libraries already supplied by the image.
python3 - <<'PY'
from pathlib import Path
root = Path('/workspace/toolchain')
for entry in list(root.rglob('*')):
    if entry.is_symlink() and not entry.exists():
        host = Path('/') / entry.relative_to(root)
        if host.exists():
            entry.unlink()
            entry.symlink_to(host.resolve())
lib = root / 'usr/lib/x86_64-linux-gnu'
for host in Path('/usr/lib/x86_64-linux-gnu').glob('*.so*'):
    target = lib / host.name
    if not target.exists() and not target.is_symlink():
        target.symlink_to(host)
PY
LD_LIBRARY_PATH="$toolchain_dir/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$toolchain_dir/usr/bin/cmake" -S "$repo_dir/obs" -B /workspace/chat-pinger-build -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$toolchain_dir/usr/bin/ninja" -DCMAKE_PREFIX_PATH="$toolchain_dir/usr" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$repo_dir/dist/obs-linux"
LD_LIBRARY_PATH="$toolchain_dir/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$toolchain_dir/usr/bin/cmake" --build /workspace/chat-pinger-build --parallel 3
