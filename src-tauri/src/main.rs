// LocalPhotoVault 桌面壳（Tauri 2）
// 职责：窗口 + 启动/停止内嵌 Web 服务（server\node.exe server.js）
// + 把服务端生成的桌面令牌转交给内嵌 WebView。
//
// 关键设计（v1.0 修复）：
//  1) 直接拉起 server\node.exe（不再经 cmd /C run.cmd），退出时用 taskkill /T 杀整棵进程树，
//     避免只杀 cmd 导致 node.exe 变成占着 8787 的僵尸进程；
//  2) 启动前做 /api/health 握手：若 8787 上跑的是「同一 BUILD_ID」的服务则复用，
//     否则视为旧版本/僵尸进程，清理后重新启动，保证换包后不会连到旧服务。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::io::{Read, Write};
use std::net::TcpStream;
use std::os::windows::process::CommandExt;

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const PORT: u16 = 8787;
const CREATE_NO_WINDOW: u32 = 0x08000000;

static SERVER: Mutex<Option<Child>> = Mutex::new(None);

fn server_dir() -> PathBuf {
    // 生产：exe 同目录的 server\；开发：cwd/server
    let exe = std::env::current_exe().expect("无法定位 exe");
    exe.parent().unwrap().join("server")
}

/// 隐藏窗口执行一个命令，返回 stdout 文本
fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn wait_port(port: u16, timeout: Duration) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    let deadline = Instant::now() + timeout;
    loop {
        if TcpStream::connect(&addr).is_ok() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// 极简 HTTP GET（HTTP/1.0 + Connection: close），返回完整响应文本
fn http_get(port: u16, path: &str) -> Option<String> {
    let mut s = TcpStream::connect(("127.0.0.1", port)).ok()?;
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(2)));
    let req = format!(
        "GET {} HTTP/1.0\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        path, port
    );
    s.write_all(req.as_bytes()).ok()?;
    let mut buf = String::new();
    s.read_to_string(&mut buf).ok()?;
    Some(buf)
}

fn body_of(resp: &str) -> &str {
    resp.split("\r\n\r\n").nth(1).unwrap_or("")
}

/// 从 JSON 文本里取一个字符串字段（够用即可，不引入依赖）
fn json_str_field(s: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\"", key);
    let i = s.find(&needle)?;
    let rest = &s[i + needle.len()..];
    let rest = &rest[rest.find(':')? + 1..];
    let rest = &rest[rest.find('"')? + 1..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// 本机 server 目录里这一次构建的 BUILD_ID
fn local_build_id() -> Option<String> {
    std::fs::read_to_string(server_dir().join(".next").join("BUILD_ID"))
        .ok()
        .map(|s| s.trim().to_string())
}

/// 找出监听指定端口的 PID
fn listener_pid(port: u16) -> Option<u32> {
    let text = run_capture("netstat", &["-ano"])?;
    let suffix = format!(":{}", port);
    for line in text.lines() {
        let t: Vec<&str> = line.split_whitespace().collect();
        if t.len() >= 5 && t[0] == "TCP" && t[1].ends_with(&suffix) && t[3] == "LISTENING" {
            if let Ok(pid) = t[4].parse::<u32>() {
                return Some(pid);
            }
        }
    }
    None
}

fn is_node_process(pid: u32) -> bool {
    match run_capture("tasklist", &["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"]) {
        Some(t) => t.to_lowercase().contains("node.exe"),
        None => false,
    }
}

fn kill_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// 确保 8787 上跑的是「本目录这一次构建」的服务
fn start_server() -> Result<(), String> {
    if wait_port(PORT, Duration::from_millis(300)) {
        let health = http_get(PORT, "/api/health").map(|r| body_of(&r).to_string()).unwrap_or_default();
        let is_ours = health.contains("\"app\":\"LocalPhotoVault\"");
        let same_build = match (local_build_id(), json_str_field(&health, "buildId")) {
            (Some(a), Some(b)) => a == b,
            _ => false,
        };

        if is_ours && same_build {
            return Ok(()); // 同版本已在运行，直接复用
        }

        // 旧版本 / 僵尸进程 → 清理后重启
        if let Some(pid) = listener_pid(PORT) {
            if is_ours || is_node_process(pid) {
                kill_tree(pid);
                for _ in 0..25 {
                    if !wait_port(PORT, Duration::from_millis(100)) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
            } else {
                return Err(format!(
                    "端口 {} 被非 LocalPhotoVault 进程占用（PID {}），请先关闭该程序再启动。",
                    PORT, pid
                ));
            }
        }
        if wait_port(PORT, Duration::from_millis(200)) {
            return Err(format!("端口 {} 仍被占用，无法启动服务。", PORT));
        }
    }

    let dir = server_dir();
    let node = dir.join("node.exe");
    let script = dir.join("server.js");
    if !node.exists() {
        return Err(format!("未找到 node.exe：{}", node.display()));
    }
    if !script.exists() {
        return Err(format!("未找到 server.js：{}", script.display()));
    }

    let child = Command::new(&node)
        .arg("server.js")
        .current_dir(&dir)
        .env_remove("NODE_OPTIONS")
        .env("PORT", PORT.to_string())
        .env("HOSTNAME", "0.0.0.0")
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动服务端失败：{}", e))?;
    *SERVER.lock().unwrap() = Some(child);

    if !wait_port(PORT, Duration::from_secs(30)) {
        return Err("服务端 30 秒内未就绪。".to_string());
    }
    Ok(())
}

/// 读取 .lpvault-boot.json 里的 photoRoot（cwd 向上找 5 层 + server 目录兜底）
fn find_boot_photo_root() -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;
    for _ in 0..5 {
        let boot = dir.join(".lpvault-boot.json");
        if boot.exists() {
            if let Ok(text) = std::fs::read_to_string(&boot) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if let Some(root) = v.get("photoRoot").and_then(|s| s.as_str()) {
                        return Some(PathBuf::from(root));
                    }
                }
            }
        }
        dir = dir.parent()?.to_path_buf();
    }
    // 服务端把 boot 配置写在 server.js 同目录，从 server 目录再找
    let boot = server_dir().join(".lpvault-boot.json");
    if boot.exists() {
        if let Ok(text) = std::fs::read_to_string(&boot) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(root) = v.get("photoRoot").and_then(|s| s.as_str()) {
                    return Some(PathBuf::from(root));
                }
            }
        }
    }
    None
}

/// 把服务端生成的桌面令牌转交给内嵌 WebView。
#[tauri::command]
fn get_desktop_token() -> Result<String, String> {
    let root = find_boot_photo_root().ok_or_else(|| "NOT_INITIALIZED".to_string())?;
    let token_path = root.join(".lpvault").join("desktop-token");
    std::fs::read_to_string(&token_path)
        .map(|s| s.trim().to_string())
        .map_err(|_| "TOKEN_NOT_READY".to_string())
}

fn main() {
    // 启动内嵌服务（失败时打印后继续，页面会显示连接失败提示）
    if let Err(e) = start_server() {
        eprintln!("[LocalPhotoVault] {}", e);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![get_desktop_token])
        .build(tauri::generate_context!())
        .expect("LocalPhotoVault 桌面壳启动失败")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // 退出时回收内嵌服务端（不删数据，只结束进程树）
                if let Some(mut child) = SERVER.lock().unwrap().take() {
                    let pid = child.id();
                    let _ = child.kill();
                    kill_tree(pid);
                }
            }
        });
}
