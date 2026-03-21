use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing manifest dir"));
    let workspace_root = manifest_dir
        .parent()
        .expect("src-tauri should live under the workspace root")
        .to_path_buf();

    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("scripts/build-sidecar-linux.mjs").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("src-sidecar/src").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("src-sidecar/package.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("src-sidecar/package-lock.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        workspace_root.join("src-sidecar/tsconfig.json").display()
    );

    let target = env::var("TARGET").expect("missing target triple");
    if target.contains("unknown-linux-gnu") {
        ensure_linux_sidecar(&workspace_root, &manifest_dir, &target);
    }

    tauri_build::build()
}

fn ensure_linux_sidecar(workspace_root: &Path, manifest_dir: &Path, target: &str) {
    let sidecar_name = format!("localteam-sidecar-{target}");
    let sidecar_path = manifest_dir.join("binaries").join(sidecar_name);
    println!("cargo:warning=building Linux sidecar at {}", sidecar_path.display());

    let status = Command::new("node")
        .arg("scripts/build-sidecar-linux.mjs")
        .arg("--target")
        .arg(target)
        .current_dir(workspace_root)
        .status()
        .expect("failed to start Linux sidecar build script");

    assert!(
        status.success(),
        "Linux sidecar build script failed with status {status}"
    );
}
