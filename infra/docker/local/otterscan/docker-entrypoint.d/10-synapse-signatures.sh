#!/bin/sh

set -eu

SOURCE_DIR="/opt/synapse-otterscan/custom-signatures"
TARGET_DIR="/usr/share/nginx/html/signatures"

if [ ! -d "$SOURCE_DIR" ] || [ ! -d "$TARGET_DIR" ]; then
  exit 0
fi

for selector_file in "$SOURCE_DIR"/*; do
  if [ ! -f "$selector_file" ]; then
    continue
  fi

  cp "$selector_file" "$TARGET_DIR/$(basename "$selector_file")"
done
