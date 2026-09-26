"""PTY transport for the public example-provider test; never used with a real vault."""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

if sys.argv[1:] != ["aac", "listen", "--provider", "example"]:
    raise SystemExit("Only the example provider is permitted")
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 180, 0, 0))
pid = os.fork()
if pid == 0:
    os.close(master)
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    for fd in (0, 1, 2):
        os.dup2(slave, fd)
    if slave > 2:
        os.close(slave)
    os.execvp("aac", sys.argv[1:])
os.close(slave)
def stop(*_):
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    while True:
        for fd in select.select([master, 0], [], [])[0]:
            data = os.read(fd, 65536)
            if not data:
                stop()
            os.write(1 if fd == master else master, data)
except OSError:
    pass
finally:
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.close(master)
