fn main() {
    // Cargo caches build scripts, and the icon is embedded by one. Without
    // these, regenerating icons/ leaves the previous artwork compiled into the
    // executable and every rebuild looks like it worked.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-changed=capabilities");

    tauri_build::build()
}
