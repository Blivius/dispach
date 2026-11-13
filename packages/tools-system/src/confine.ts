/**
 * `confine: agent` (0.2.6): a command runs inside its own agent's directory and nowhere else.
 *
 * Several agents share one runtime on a hosted silo, all as the same user, so a plain `exec` could
 * read another agent's notes, the runtime's `store.db` (every conversation) and
 * `/proc/<runtime>/environ` (its credentials). The roots never bound `exec` because a shell string
 * carries its targets where no path check can see them; a kernel boundary can.
 *
 * **Landlock**, because it needs no privilege: the runtime runs as an ordinary user with no
 * capabilities, and Docker's default seccomp blocks the user namespaces bubblewrap would need. The
 * launcher below restricts itself (a Landlock ruleset is inherited by everything it starts, and cannot
 * be loosened), then execs the command. Allowed: the agent's own directory and its writeRoots
 * read-write, the system's programs and libraries read-only, a few devices. Everything else, the
 * other agents and the runtime's state included, is refused by the kernel. Landlock also refuses a
 * confined process access to a less-confined one, which is what keeps `/proc/<runtime>/environ`
 * closed although `/proc` itself is readable.
 *
 * Python, because Node cannot make the three syscalls and Python's `ctypes` can, and `python3` is
 * already in the image. Passed as `python3 -I -c` so there is no file to ship and `-I` ignores the
 * environment and the working directory, which belong to the agent. Linux only, like Landlock; where
 * it is missing a confined `exec` refuses rather than runs unconfined (decided 2026-11-13).
 *
 * Measured on a Docker Desktop bind mount from macOS (virtiofs): the rules did not match the agent's
 * own directory, so its own writes were refused too. That fails closed, never open. A named volume,
 * which is what a silo uses, and an ordinary Linux filesystem both behave.
 */

import { spawnSync } from "node:child_process"
import { join } from "node:path"

/**
 * argv: `<rw dir>... r:<read-only dir>... -- <file> <args>...`. Exit 125 with a `dispach-confine:` line when the kernel
 * cannot confine, before anything runs.
 */
export const LAUNCHER = String.raw`
import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
def die(why):
    sys.stderr.write("dispach-confine: " + why + "\n"); sys.exit(125)
abi = libc.syscall(444, None, 0, 1)
if abi < 1: die("Landlock is not available: " + os.strerror(ctypes.get_errno()))
FS = (1 << 13) - 1
if abi >= 2: FS |= 1 << 13
if abi >= 3: FS |= 1 << 14
FILE = (1 << 0) | (1 << 1) | (1 << 2) | (FS & (1 << 14))
READ = (1 << 0) | (1 << 2) | (1 << 3)
class Attr(ctypes.Structure): _fields_ = [("fs", ctypes.c_uint64)]
class Rule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("allowed", ctypes.c_uint64), ("fd", ctypes.c_int32)]
attr = Attr(FS)
rs = libc.syscall(444, ctypes.byref(attr), ctypes.sizeof(attr), 0)
if rs < 0: die("could not create a ruleset: " + os.strerror(ctypes.get_errno()))
def allow(path, rights):
    try: fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
    except OSError: return
    if not os.path.isdir(path): rights &= FILE
    rule = Rule(rights, fd)
    ok = libc.syscall(445, rs, 1, ctypes.byref(rule), 0)
    os.close(fd)
    if ok != 0: die("could not allow " + path + ": " + os.strerror(ctypes.get_errno()))
split = sys.argv.index("--")
for path in ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt", "/proc", "/sys"]:
    allow(path, READ)
for path in ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/tty", "/dev/ptmx", "/dev/pts"]:
    allow(path, FS)
for path in sys.argv[1:split]: allow(path[2:], READ) if path.startswith("r:") else allow(path, FS)
if libc.prctl(38, 1, 0, 0, 0) != 0: die("could not set no_new_privs")
if libc.syscall(446, rs, 0) != 0: die("could not restrict: " + os.strerror(ctypes.get_errno()))
os.execvp(sys.argv[split + 1], sys.argv[split + 1:])
`

/**
 * What a confined command runs inside. `confine: agent`: the agent's directory and any
 * operator-granted roots. `confine: workspace` (0.2.7): only the agent's workspace and its temp, with
 * its skills readable - so the rest of the agent's directory (`.env`, `agent.yaml`, a channel's
 * session) is out of a command's reach, and an agent that holds credentials can still have a shell.
 */
export interface Confinement {
    readonly agentDir: string
    readonly writable: readonly string[]
    readonly readable?: readonly string[]
}

/** The agent's private temp: `TMPDIR`, `HOME` and the command's own status files live here. */
export function confinedTemp(agentDir: string): string {
    return join(agentDir, ".tmp")
}

/** `file args` wrapped in the launcher. */
export function confinedCommand(
    confinement: Confinement,
    file: string,
    args: readonly string[],
): { file: string; args: string[] } {
    return {
        file: "python3",
        args: [
            "-I",
            "-c",
            LAUNCHER,
            ...confinement.writable,
            ...(confinement.readable ?? []).map((path) => `r:${path}`),
            "--",
            file,
            ...args,
        ],
    }
}

let support: string | undefined | null = null

/**
 * Why commands cannot be confined here, or undefined when they can. Asked once per process: the
 * kernel does not change under a running runtime.
 */
export function confineUnsupported(): string | undefined {
    if (support !== null) return support
    if (process.platform !== "linux") {
        support = `this runs on ${process.platform}, and Landlock is Linux's`
        return support
    }
    const probe = spawnSync(
        "python3",
        ["-I", "-c", "import ctypes;l=ctypes.CDLL(None);print(l.syscall(444,None,0,1))"],
        { encoding: "utf8", timeout: 5_000 },
    )
    const abi = Number(probe.stdout?.trim())
    support =
        probe.error !== undefined
            ? `python3 could not be started (${probe.error.message})`
            : Number.isInteger(abi) && abi >= 1
              ? undefined
              : "the kernel has no Landlock, or it is switched off"
    return support
}

/** For tests: forget the cached answer. */
export function resetConfineSupport(): void {
    support = null
}
