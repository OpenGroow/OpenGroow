/** A machine tool shaped like the Android CLI (a Python venv + ADB), for tests. */
export const ANDROID_TOOL_FIXTURE = {
  name: "Android CLI",
  minVersion: "0.1.0",
  instructionsUrl: "https://example.com/android-cli",
  install: {
    id: "android",
    source: {
      url: "https://github.com/OpenGroow/private-groowhub/releases/download/android@0.1.0/android-0.1.0.tgz",
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
    requires: [
      { name: "Python 3", check: ["python3", "--version"], instructionsUrl: "https://www.python.org/downloads/" },
      { name: "ADB", check: ["adb", "version"], instructionsUrl: "https://developer.android.com/tools/adb" },
    ],
    bootstrap: [
      { label: "Create the Python virtual environment", run: ["python3", "-m", "venv", "{dir}/engine/.venv"] },
      {
        label: "Install the engine dependencies",
        run: ["{dir}/engine/.venv/bin/pip", "install", "-r", "{dir}/engine/requirements.txt"],
      },
    ],
    versionCheck: { run: ["{dir}/bin/opengroow-android", "--version"] },
  },
};
