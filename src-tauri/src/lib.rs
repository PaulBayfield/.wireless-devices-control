//! Devices desktop app: the web app in a window, plus what a browser can't do.
//!
//! - The server address and personal API key are kept in the OS credential store (Windows
//!   Credential Manager, macOS Keychain, Secret Service on Linux), never in the webview's storage.
//! - A tray icon, close-to-tray, start at sign-in and a single instance (see shell.rs).
//! - The agent, started with the app and kept running (see agent.rs).

mod agent;
mod shell;

use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "dev.bayfield.devices";
const KEYRING_USER: &str = "connection";

/// Which Devices server to use, and the personal API key to use it with.
#[derive(Serialize, Deserialize)]
struct Connection {
    url: String,
    key: String,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(err)
}

/// The saved connection, or `None` before the first one (or after signing out).
#[tauri::command]
fn load_connection() -> Result<Option<Connection>, String> {
    match entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).ok()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(err(e)),
    }
}

/// Saves the connection, or forgets it with `None`.
#[tauri::command]
fn save_connection(connection: Option<Connection>) -> Result<(), String> {
    let entry = entry()?;
    match connection {
        Some(c) => entry.set_password(&serde_json::to_string(&c).map_err(err)?).map_err(err),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(err(e)),
        },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must come first: a second launch (e.g. from the Start menu while the app sits in
        // the tray) just brings the running window back.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show_main_window(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(agent::AgentState::default())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![shell::MINIMIZED_ARG]),
        ))
        .setup(|app| {
            shell::setup(app)?;
            agent::start(app.handle());
            Ok(())
        })
        .on_window_event(shell::on_window_event)
        .invoke_handler(tauri::generate_handler![
            load_connection,
            save_connection,
            shell::set_close_to_tray,
            shell::set_tray_labels,
            agent::agent_request,
            agent::agent_info,
            agent::agent_link,
            agent::agent_unlink
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // The agent goes with the app (it would also stop on its own once its stdin closes).
            if let tauri::RunEvent::Exit = event {
                agent::shutdown(app);
            }
        });
}
