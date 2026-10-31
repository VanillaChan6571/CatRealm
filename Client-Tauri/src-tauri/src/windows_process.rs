//! Small native Windows process helpers shared by diagnostics, game activity,
//! and capture cleanup. Keeping this in Rust avoids repeatedly launching
//! PowerShell/WMI just to inspect the local process table.

use std::ffi::c_void;
use windows::Wdk::System::Threading::{NtQueryInformationProcess, ProcessCommandLineInformation};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, UNICODE_STRING};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::ProcessStatus::{
    K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
};
use windows::Win32::System::Threading::{
    GetProcessTimes, OpenProcess, TerminateProcess, PROCESS_QUERY_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, PROCESS_VM_READ,
};

#[derive(Clone, Debug)]
pub(crate) struct ProcessInfo {
    pub(crate) pid: u32,
    pub(crate) parent_pid: u32,
    pub(crate) name: String,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ProcessMemory {
    pub(crate) working_set_bytes: usize,
    pub(crate) private_bytes: usize,
}

struct OwnedHandle(HANDLE);

impl OwnedHandle {
    fn open(
        pid: u32,
        access: windows::Win32::System::Threading::PROCESS_ACCESS_RIGHTS,
    ) -> Option<Self> {
        unsafe { OpenProcess(access, false, pid) }.ok().map(Self)
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

pub(crate) fn snapshot() -> Result<Vec<ProcessInfo>, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map(OwnedHandle)
        .map_err(|error| format!("unable to snapshot Windows processes: {error}"))?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    unsafe { Process32FirstW(snapshot.0, &mut entry) }
        .map_err(|error| format!("unable to enumerate Windows processes: {error}"))?;

    let mut processes = Vec::new();
    loop {
        let name_len = entry
            .szExeFile
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(entry.szExeFile.len());
        processes.push(ProcessInfo {
            pid: entry.th32ProcessID,
            parent_pid: entry.th32ParentProcessID,
            name: String::from_utf16_lossy(&entry.szExeFile[..name_len]),
        });
        if unsafe { Process32NextW(snapshot.0, &mut entry) }.is_err() {
            break;
        }
    }
    Ok(processes)
}

pub(crate) fn started_at(pid: u32) -> Option<i64> {
    let process = OwnedHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    unsafe { GetProcessTimes(process.0, &mut created, &mut exited, &mut kernel, &mut user) }
        .ok()?;
    let ticks = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
    filetime_to_unix_seconds(ticks)
}

pub(crate) fn memory(pid: u32) -> Option<ProcessMemory> {
    let process = OwnedHandle::open(pid, PROCESS_QUERY_INFORMATION | PROCESS_VM_READ)?;
    let mut counters = PROCESS_MEMORY_COUNTERS_EX {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        ..Default::default()
    };
    let ok = unsafe {
        K32GetProcessMemoryInfo(
            process.0,
            (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX).cast::<PROCESS_MEMORY_COUNTERS>(),
            counters.cb,
        )
    };
    ok.as_bool().then_some(ProcessMemory {
        working_set_bytes: counters.WorkingSetSize,
        private_bytes: counters.PrivateUsage,
    })
}

pub(crate) fn command_line(pid: u32) -> Option<String> {
    const MAX_COMMAND_LINE_BYTES: u32 = 1024 * 1024;
    let process = OwnedHandle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
    let mut required = 0u32;
    let _ = unsafe {
        NtQueryInformationProcess(
            process.0,
            ProcessCommandLineInformation,
            std::ptr::null_mut(),
            0,
            &mut required,
        )
    };
    if required < std::mem::size_of::<UNICODE_STRING>() as u32 || required > MAX_COMMAND_LINE_BYTES
    {
        return None;
    }

    // usize-backed storage guarantees the alignment required by UNICODE_STRING.
    let units = usize::try_from(required)
        .ok()?
        .div_ceil(std::mem::size_of::<usize>());
    let mut storage = vec![0usize; units];
    let status = unsafe {
        NtQueryInformationProcess(
            process.0,
            ProcessCommandLineInformation,
            storage.as_mut_ptr().cast::<c_void>(),
            required,
            &mut required,
        )
    };
    if status.is_err() {
        return None;
    }

    let value = unsafe { &*(storage.as_ptr().cast::<UNICODE_STRING>()) };
    let byte_len = usize::from(value.Length);
    if byte_len == 0 || byte_len % 2 != 0 || value.Buffer.0.is_null() {
        return None;
    }
    let allocation_start = storage.as_ptr() as usize;
    let allocation_end =
        allocation_start.checked_add(storage.len() * std::mem::size_of::<usize>())?;
    let text_start = value.Buffer.0 as usize;
    let text_end = text_start.checked_add(byte_len)?;
    if text_start < allocation_start || text_end > allocation_end {
        return None;
    }
    let text = unsafe { std::slice::from_raw_parts(value.Buffer.0, byte_len / 2) };
    Some(String::from_utf16_lossy(text))
}

pub(crate) fn terminate(pid: u32) -> bool {
    let Some(process) = OwnedHandle::open(pid, PROCESS_TERMINATE) else {
        return false;
    };
    unsafe { TerminateProcess(process.0, 1) }.is_ok()
}

fn filetime_to_unix_seconds(ticks: u64) -> Option<i64> {
    const WINDOWS_TO_UNIX_EPOCH_100NS: u64 = 116_444_736_000_000_000;
    const TICKS_PER_SECOND: u64 = 10_000_000;
    let unix_ticks = ticks.checked_sub(WINDOWS_TO_UNIX_EPOCH_100NS)?;
    i64::try_from(unix_ticks / TICKS_PER_SECOND).ok()
}
