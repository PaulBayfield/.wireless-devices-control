//! Desktop integration: system tray, close-to-tray and the window shown on launch.
//!
//! Closing the window only hides it (unless the user turned that off); the tray icon brings it
//! back or quits.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, Runtime, Window, WindowEvent};

/// Launch argument added by the autostart entry: start hidden in the tray.
pub const MINIMIZED_ARG: &str = "--minimized";
const TRAY_ID: &str = "main";

struct CloseToTray(AtomicBool);

/// The tray menu's labels; the webview sets them in the UI language.
struct TrayLabels {
    open: String,
    quit: String,
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, labels: &TrayLabels) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "open", &labels.open, true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "quit", &labels.quit, true, None::<&str>)?)?;
    Ok(menu)
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    app.manage(CloseToTray(AtomicBool::new(true)));

    let labels = TrayLabels { open: "Open Devices".into(), quit: "Quit".into() };
    let menu = build_menu(app.handle(), &labels)?;
    app.manage(Mutex::new(labels));

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Devices")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    // The window is created hidden so an autostart launch doesn't flash it on screen.
    if !std::env::args().any(|a| a == MINIMIZED_ARG) {
        show_main_window(app.handle());
    }
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.state::<CloseToTray>().0.load(Ordering::Relaxed) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[tauri::command]
pub fn set_close_to_tray(app: AppHandle, enabled: bool) {
    app.state::<CloseToTray>().0.store(enabled, Ordering::Relaxed);
}

/// The tray menu is built before the webview knows the UI language, so it relabels it.
#[tauri::command]
pub fn set_tray_labels(app: AppHandle, open: String, quit: String) -> Result<(), String> {
    let state = app.state::<Mutex<TrayLabels>>();
    let mut labels = state.lock().map_err(|e| e.to_string())?;
    (labels.open, labels.quit) = (open, quit);
    let menu = build_menu(&app, &labels).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
