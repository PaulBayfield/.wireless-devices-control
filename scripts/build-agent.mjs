// Builds the agent into one executable (PyInstaller) and puts it where Tauri bundles it from:
// src-tauri/binaries/devices-agent-<target triple>.exe. Run before `npm run tauri dev|build`.
//   npm run agent:build

import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const agent = resolve(root, "agent");
const ext = process.platform === "win32" ? ".exe" : "";

execSync("uv run --group build pyinstaller devices-agent.spec --noconfirm --log-level WARN", { cwd: agent, stdio: "inherit" });

const triple = execSync("rustc -vV").toString().match(/host: (\S+)/)[1];
const target = resolve(root, "src-tauri", "binaries", `devices-agent-${triple}${ext}`);
mkdirSync(resolve(target, ".."), { recursive: true });
copyFileSync(resolve(agent, "dist", `devices-agent${ext}`), target);
console.log(`Agent built: ${target}`);
