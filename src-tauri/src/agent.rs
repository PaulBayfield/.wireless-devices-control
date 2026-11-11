//! The agent (agent/ in this repository), built by PyInstaller into a folder that is installed
//! next to the app (agent/devices-agent.exe): started from there, it doesn't unpack itself into
//! %TEMP% at every launch, which behavioural antivirus engines take for a trojan.
//!
//! The app starts it when it starts, restarts it if it stops, and talks to it on its stdin and
//! stdout in JSON lines (see agent/src/agent/ipc.py): requests from the webview go through the
//! `agent_request` command, and what the agent pushes (a reading after every poll) is forwarded to
//! the webview as `agent-event`. No port, no token.
//!
//! Linking the computer to devices.bayfield.dev gives the agent its key; it is kept in the OS
//! credential store, next to the app's own connection.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::oneshot;

const KEYRING_SERVICE: &str = "dev.bayfield.devices";
const KEYRING_LINK: &str = "agent-link";
/// How long a request may take: Bluetooth reads and writes can be slow.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Wait before starting the agent again after it stopped.
const RESTART_DELAY: Duration = Duration::from_secs(5);
/// agent.log starts over past this size.
const LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;

/// This computer's link to the server: where to report, and the agent key to do it with.
#[derive(Serialize, Deserialize, Clone)]
pub struct Link {
    pub server: String,
    pub key: String,
    pub host_id: String,
    pub name: String,
}

#[derive(Default)]
pub struct AgentState {
    child: Mutex<Option<CommandChild>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
    running: AtomicBool,
    quitting: AtomicBool,
    /// What the agent writes on stderr (its log), for troubleshooting.
    log: Mutex<Option<File>>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn link_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_LINK).map_err(err)
}

pub fn load_link() -> Option<Link> {
    let json = link_entry().ok()?.get_password().ok()?;
    serde_json::from_str(&json).ok()
}

/// This computer's name, as the link page shows it.
pub fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "This computer".into())
}

/// Starts the agent, and starts it again whenever it stops, until the app quits.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let state = app.state::<AgentState>();
            if state.quitting.load(Ordering::Relaxed) {
                break;
            }
            match spawn(&app) {
                Ok(mut events) => {
                    state.running.store(true, Ordering::Relaxed);
                    let _ = app.emit("agent-status", json!({ "running": true }));
                    while let Some(event) = events.recv().await {
                        match event {
                            CommandEvent::Stdout(line) => on_line(&app, &line),
                            CommandEvent::Stderr(line) => log(&app, &String::from_utf8_lossy(&line)),
                            CommandEvent::Terminated(status) => {
                                log(&app, &format!("[app] the agent stopped: {status:?}"));
                                break;
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => log(&app, &format!("[app] could not start the agent: {e}")),
            }
            let state = app.state::<AgentState>();
            state.running.store(false, Ordering::Relaxed);
            state.child.lock().unwrap().take();
            // Whatever was waiting for an answer won't get one from this process.
            for (_, waiter) in state.pending.lock().unwrap().drain() {
                let _ = waiter.send(json!({ "error": { "status": 503, "message": "The agent stopped" } }));
            }
            let _ = app.emit("agent-status", json!({ "running": false }));
            if state.quitting.load(Ordering::Relaxed) {
                break;
            }
            tokio::time::sleep(RESTART_DELAY).await;
        }
    });
}

/// Appends a line to agent.log (in the app's data folder, next to the agent's history).
fn log(app: &AppHandle, line: &str) {
    let line = line.trim_end();
    eprintln!("[agent] {line}");
    if let Some(file) = app.state::<AgentState>().log.lock().unwrap().as_mut() {
        let _ = writeln!(file, "{line}");
    }
}

fn open_log(dir: &std::path::Path) -> Option<File> {
    let path = dir.join("agent.log");
    let too_big = std::fs::metadata(&path).map(|m| m.len() > LOG_MAX_BYTES).unwrap_or(false);
    OpenOptions::new().create(true).append(!too_big).write(true).truncate(too_big).open(path).ok()
}

fn spawn(app: &AppHandle) -> Result<tauri::async_runtime::Receiver<CommandEvent>, String> {
    // Its history and log live with the app's data.
    let dir = app.path().app_data_dir().map_err(err)?.join("agent");
    std::fs::create_dir_all(&dir).map_err(err)?;
    *app.state::<AgentState>().log.lock().unwrap() = open_log(&dir);
    let exe = app
        .path()
        .resolve(if cfg!(windows) { "agent/devices-agent.exe" } else { "agent/devices-agent" }, BaseDirectory::Resource)
        .map_err(err)?;
    if !exe.exists() {
        return Err(format!("{} is missing: build it with `npm run agent:build`", exe.display()));
    }
    let mut command = app
        .shell()
        .command(exe.to_string_lossy().to_string())
        .args(["serve", "--ipc"])
        .current_dir(&dir)
        .env("HISTORY_PATH", dir.join("battery.db").to_string_lossy().to_string())
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8");
    if let Some(link) = load_link() {
        command = command.env("CENTRAL_URL", link.server).env("AGENT_KEY", link.key).env("AGENT_NAME", link.name);
    }
    let (events, child) = command.spawn().map_err(err)?;
    *app.state::<AgentState>().child.lock().unwrap() = Some(child);
    Ok(events)
}

/// A line from the agent: the answer to a request, or an event to forward to the webview.
fn on_line(app: &AppHandle, line: &[u8]) {
    let Ok(message) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        if let Some(waiter) = app.state::<AgentState>().pending.lock().unwrap().remove(&id) {
            let _ = waiter.send(message);
        }
    } else if message.get("event").is_some() {
        let _ = app.emit("agent-event", message);
    }
}

/// Stops the agent (to restart it with a new link, or when the app quits).
fn stop(app: &AppHandle) {
    if let Some(child) = app.state::<AgentState>().child.lock().unwrap().take() {
        let _ = child.kill();
    }
}

pub fn shutdown(app: &AppHandle) {
    app.state::<AgentState>().quitting.store(true, Ordering::Relaxed);
    stop(app);
}

/// Sends a request to the agent and waits for its answer: the result, or the agent's error.
#[tauri::command]
pub async fn agent_request(app: AppHandle, method: String, params: Option<Value>) -> Result<Value, Value> {
    let state = app.state::<AgentState>();
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let (tx, rx) = oneshot::channel();
    state.pending.lock().unwrap().insert(id, tx);
    let line = json!({ "id": id, "method": method, "params": params.unwrap_or(json!({})) }).to_string() + "\n";
    let written = match state.child.lock().unwrap().as_mut() {
        Some(child) => child.write(line.as_bytes()).map_err(err),
        None => Err("The agent isn't running".into()),
    };
    if let Err(message) = written {
        state.pending.lock().unwrap().remove(&id);
        return Err(json!({ "status": 503, "message": message }));
    }
    let answer = match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
        Ok(Ok(answer)) => answer,
        _ => {
            state.pending.lock().unwrap().remove(&id);
            return Err(json!({ "status": 504, "message": "The agent didn't answer in time" }));
        }
    };
    match answer.get("error") {
        Some(error) => Err(error.clone()),
        None => Ok(answer.get("result").cloned().unwrap_or(Value::Null)),
    }
}

#[derive(Serialize)]
pub struct AgentInfo {
    running: bool,
    computer: String,
    link: Option<LinkInfo>,
}

#[derive(Serialize)]
pub struct LinkInfo {
    server: String,
    host_id: String,
    name: String,
}

/// Whether the agent runs, this computer's name, and what it is linked to (never the key).
#[tauri::command]
pub fn agent_info(app: AppHandle) -> AgentInfo {
    AgentInfo {
        running: app.state::<AgentState>().running.load(Ordering::Relaxed),
        computer: computer_name(),
        link: load_link().map(|l| LinkInfo { server: l.server, host_id: l.host_id, name: l.name }),
    }
}

/// Keeps the link the app got from the server, and restarts the agent with it.
#[tauri::command]
pub fn agent_link(app: AppHandle, link: Link) -> Result<(), String> {
    link_entry()?.set_password(&serde_json::to_string(&link).map_err(err)?).map_err(err)?;
    stop(&app); // the supervisor starts it again, with the key
    Ok(())
}

/// Forgets the link: the agent keeps running, with its history on this computer only.
#[tauri::command]
pub fn agent_unlink(app: AppHandle) -> Result<(), String> {
    match link_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(err(e)),
    }
    stop(&app);
    Ok(())
}
