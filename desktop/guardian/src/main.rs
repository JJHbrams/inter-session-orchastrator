#[cfg(not(windows))]
fn main() {
    eprintln!("guardian is supported on Windows only");
    std::process::exit(2);
}

#[cfg(windows)]
mod app {
    use std::{
        env,
        ffi::{c_void, OsStr},
        fs::{File, OpenOptions},
        io,
        mem::{size_of, zeroed},
        os::windows::{ffi::OsStrExt, fs::OpenOptionsExt},
        path::{Path, PathBuf},
        ptr::{null, null_mut},
        thread,
        time::Duration,
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0},
        Storage::FileSystem::FILE_SHARE_NONE,
        System::{
            Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{
                CreateProcessW, DeleteProcThreadAttributeList, GetCurrentProcess,
                GetCurrentProcessId, GetExitCodeProcess, GetProcessTimes,
                InitializeProcThreadAttributeList, OpenProcess, ResumeThread, TerminateProcess,
                UpdateProcThreadAttribute, WaitForMultipleObjects, CREATE_NO_WINDOW,
                CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT,
                LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
                STARTUPINFOEXW,
            },
        },
    };
    const PARENT_ACCESS: u32 = 0x0010_0000 | 0x1000;
    struct Args {
        node: PathBuf,
        entry: PathBuf,
        profile: PathBuf,
        parent: u32,
        knowledge: Option<PathBuf>,
    }
    struct Handle(HANDLE);
    impl Handle {
        fn new(h: HANDLE) -> io::Result<Self> {
            if h.is_null() || h == INVALID_HANDLE_VALUE {
                Err(io::Error::last_os_error())
            } else {
                Ok(Self(h))
            }
        }
    }
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    fn fail(code: &str, msg: &str) -> ! {
        println!(
            "{}",
            serde_json::json!({"type":"error","code":code,"message":msg})
        );
        std::process::exit(2)
    }
    fn usage() -> ! {
        fail("INVALID_ARGUMENT","guardian.exe --node <absolute> --entry <absolute> --profile <absolute> --parent-pid <pid> [--knowledge-root <absolute>]")
    }
    fn abs(v: String) -> PathBuf {
        let p = PathBuf::from(v);
        if p.is_absolute() {
            p
        } else {
            usage()
        }
    }
    fn args() -> Args {
        let (mut n, mut e, mut p, mut q, mut k) = (None, None, None, None, None);
        let mut it = env::args_os().skip(1);
        while let Some(f) = it.next() {
            let v = it.next().unwrap_or_else(|| usage());
            match f.to_string_lossy().as_ref() {
                "--node" => n = Some(abs(v.to_string_lossy().into_owned())),
                "--entry" => e = Some(abs(v.to_string_lossy().into_owned())),
                "--profile" => p = Some(abs(v.to_string_lossy().into_owned())),
                "--parent-pid" => q = v.to_string_lossy().parse().ok(),
                "--knowledge-root" => k = Some(abs(v.to_string_lossy().into_owned())),
                _ => usage(),
            }
        }
        let x = Args {
            node: n.unwrap_or_else(|| usage()),
            entry: e.unwrap_or_else(|| usage()),
            profile: p.unwrap_or_else(|| usage()),
            parent: q.unwrap_or_else(|| usage()),
            knowledge: k,
        };
        if x.profile.parent().is_none() {
            fail("INVALID_ARGUMENT", "profile must not be a filesystem root")
        }
        if !x.node.is_file() || !x.entry.is_file() {
            fail("INVALID_ARGUMENT", "node and entry must be existing files")
        }
        x
    }
    fn lock(p: &Path) -> io::Result<File> {
        std::fs::create_dir_all(p)?;
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .share_mode(FILE_SHARE_NONE)
            .open(p.join(".desktop.lock"))
    }
    unsafe fn parent_of(pid: u32) -> Option<u32> {
        let s = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if s == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut e: PROCESSENTRY32W = zeroed();
        e.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        if Process32FirstW(s, &mut e) != 0 {
            loop {
                if e.th32ProcessID == pid {
                    found = Some(e.th32ParentProcessID);
                    break;
                }
                if Process32NextW(s, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(s);
        found
    }
    unsafe fn created_at(process: HANDLE) -> io::Result<u64> {
        let mut created: FILETIME = zeroed();
        let mut exited: FILETIME = zeroed();
        let mut kernel: FILETIME = zeroed();
        let mut user: FILETIME = zeroed();
        if GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(((created.dwHighDateTime as u64) << 32) | created.dwLowDateTime as u64)
    }
    fn quote(v: &OsStr) -> String {
        let s = v.to_string_lossy();
        let mut r = String::from("\"");
        let mut b = 0;
        for c in s.chars() {
            if c == '\\' {
                b += 1
            } else if c == '\"' {
                r.push_str(&"\\".repeat(b * 2 + 1));
                r.push(c);
                b = 0
            } else {
                r.push_str(&"\\".repeat(b));
                r.push(c);
                b = 0
            }
        }
        r.push_str(&"\\".repeat(b * 2));
        r.push('\"');
        r
    }
    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(Some(0)).collect()
    }
    unsafe fn job() -> Handle {
        let h = Handle::new(CreateJobObjectW(null(), null()))
            .unwrap_or_else(|e| fail("JOB_CREATE_FAILED", &e.to_string()));
        let mut l: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        l.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            h.0,
            JobObjectExtendedLimitInformation,
            &l as *const _ as _,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            fail("JOB_CONFIG_FAILED", &io::Error::last_os_error().to_string())
        }
        h
    }
    unsafe fn launch(a: &Args, j: HANDLE) -> (Handle, Handle) {
        let mut c = format!(
            "{} {} --profile {} --guardian-pid {}",
            quote(a.node.as_os_str()),
            quote(a.entry.as_os_str()),
            quote(a.profile.as_os_str()),
            GetCurrentProcessId()
        );
        if let Some(k) = &a.knowledge {
            c.push_str(" --knowledge-root ");
            c.push_str(&quote(k.as_os_str()))
        }
        let mut c = wide(&c);
        let handles = [
            GetStdHandle(STD_INPUT_HANDLE),
            GetStdHandle(STD_OUTPUT_HANDLE),
            GetStdHandle(STD_ERROR_HANDLE),
        ];
        if handles
            .iter()
            .any(|h| h.is_null() || *h == INVALID_HANDLE_VALUE)
        {
            fail(
                "STDIO_UNAVAILABLE",
                "guardian requires valid standard handles",
            )
        };
        let mut bytes = 0usize;
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut bytes);
        let mut attrs = vec![0u8; bytes];
        let list = attrs.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
        if InitializeProcThreadAttributeList(list, 1, 0, &mut bytes) == 0 {
            fail(
                "ATTRIBUTE_LIST_FAILED",
                &io::Error::last_os_error().to_string(),
            )
        };
        if UpdateProcThreadAttribute(
            list,
            0,
            0x0002_0002,
            handles.as_ptr() as *mut c_void,
            size_of::<HANDLE>() * handles.len(),
            null_mut(),
            null_mut(),
        ) == 0
        {
            DeleteProcThreadAttributeList(list);
            fail(
                "HANDLE_LIST_FAILED",
                &io::Error::last_os_error().to_string(),
            )
        };
        let mut s: STARTUPINFOEXW = zeroed();
        s.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        s.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        s.StartupInfo.hStdInput = handles[0];
        s.StartupInfo.hStdOutput = handles[1];
        s.StartupInfo.hStdError = handles[2];
        s.lpAttributeList = list;
        let mut pi: PROCESS_INFORMATION = zeroed();
        let flags = CREATE_SUSPENDED
            | EXTENDED_STARTUPINFO_PRESENT
            | CREATE_UNICODE_ENVIRONMENT
            | CREATE_NO_WINDOW;
        if CreateProcessW(
            null(),
            c.as_mut_ptr(),
            null(),
            null(),
            1,
            flags,
            null(),
            null(),
            &s.StartupInfo,
            &mut pi,
        ) == 0
        {
            DeleteProcThreadAttributeList(list);
            fail(
                "NODE_CREATE_FAILED",
                &io::Error::last_os_error().to_string(),
            )
        }
        DeleteProcThreadAttributeList(list);
        let p = Handle::new(pi.hProcess).unwrap();
        let t = Handle::new(pi.hThread).unwrap();
        if AssignProcessToJobObject(j, p.0) == 0 {
            let why = io::Error::last_os_error();
            TerminateProcess(p.0, 1);
            WaitForMultipleObjects(1, &p.0, 1, u32::MAX);
            fail("JOB_ASSIGN_FAILED", &why.to_string())
        }
        if ResumeThread(t.0) == u32::MAX {
            let why = io::Error::last_os_error();
            TerminateJobObject(j, 1);
            WaitForMultipleObjects(1, &p.0, 1, u32::MAX);
            fail("NODE_RESUME_FAILED", &why.to_string())
        }
        (p, t)
    }
    pub fn run() {
        let a = args();
        if unsafe { parent_of(GetCurrentProcessId()) } != Some(a.parent) {
            fail(
                "PARENT_PID_MISMATCH",
                "--parent-pid is not guardian's actual parent",
            )
        }
        let _l = match lock(&a.profile) {
            Ok(x) => x,
            Err(x) if x.raw_os_error() == Some(32) => {
                fail("PROFILE_IN_USE", "profile is already owned")
            }
            Err(x) => fail("PROFILE_LOCK_FAILED", &x.to_string()),
        };
        let par = unsafe {
            Handle::new(OpenProcess(PARENT_ACCESS, 0, a.parent))
                .unwrap_or_else(|x| fail("PARENT_OPEN_FAILED", &x.to_string()))
        };
        if unsafe { created_at(par.0) }
            .unwrap_or_else(|x| fail("PROCESS_TIME_FAILED", &x.to_string()))
            > unsafe { created_at(GetCurrentProcess()) }
                .unwrap_or_else(|x| fail("PROCESS_TIME_FAILED", &x.to_string()))
        {
            fail(
                "PARENT_PID_REUSED",
                "--parent-pid was reused after guardian creation",
            )
        }
        let j = unsafe { job() };
        let (ch, _t) = unsafe { launch(&a, j.0) };
        let hs = [par.0, ch.0];
        let w = unsafe { WaitForMultipleObjects(2, hs.as_ptr(), 0, u32::MAX) };
        if w == WAIT_OBJECT_0 {
            thread::sleep(Duration::from_millis(5000));
            unsafe {
                TerminateJobObject(j.0, 1);
            }
        } else if w != WAIT_OBJECT_0 + 1 {
            unsafe {
                TerminateJobObject(j.0, 1);
            }
            fail("WAIT_FAILED", &format!("wait returned {w}"))
        }
        let mut code = 1;
        if unsafe { GetExitCodeProcess(ch.0, &mut code) } == 0 {
            unsafe {
                TerminateJobObject(j.0, 1);
            }
            fail(
                "CHILD_EXIT_STATUS_FAILED",
                &io::Error::last_os_error().to_string(),
            )
        }
        std::process::exit(code as i32)
    }
}
#[cfg(windows)]
fn main() {
    app::run()
}
