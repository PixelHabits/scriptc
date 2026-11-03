#!/bin/sh
# Node's Temporal implementation requires rustc and cargo >=1.86.
export CARGO_HOME="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/scriptc-cargo"
export RUSTUP_HOME="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/scriptc-rustup"
curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/scriptc-rustup-init.sh"
sh "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/scriptc-rustup-init.sh" -y --profile minimal --default-toolchain 1.86.0 --no-modify-path
export PATH="$CARGO_HOME/bin:$PATH"
rustc --version
cargo --version
if [ -n "${GITHUB_PATH:-}" ]; then
  echo "$CARGO_HOME/bin" >> "$GITHUB_PATH"
  printf 'CARGO_HOME=%s\nRUSTUP_HOME=%s\n' "$CARGO_HOME" "$RUSTUP_HOME" >> "$GITHUB_ENV"
fi
