// Builds the agent (PyInstaller, as a folder) and puts it where Tauri bundles it from:
// src-tauri/binaries/devices-agent/, installed next to the app as agent/. Run before
// `npm run tauri dev|build`.
//   npm run agent:build

import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const agent = resolve(root, "agent");

execSync("uv run --group build pyinstaller devices-agent.spec --noconfirm --log-level WARN", { cwd: agent, stdio: "inherit" });

const target = resolve(root, "src-tauri", "binaries", "devices-agent");
rmSync(resolve(root, "src-tauri", "binaries"), { recursive: true, force: true });
cpSync(resolve(agent, "dist", "devices-agent"), target, { recursive: true });
console.log(`Agent built: ${target}`);
