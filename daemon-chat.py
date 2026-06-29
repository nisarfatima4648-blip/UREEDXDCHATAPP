import os, sys, time, signal, subprocess

def fork_daemon():
    """Double fork to fully detach"""
    if os.fork() > 0: sys.exit(0)
    os.setsid()
    if os.fork() > 0: sys.exit(0)
    os.chdir('/')
    signal.signal(signal.SIGHUP, signal.SIG_IGN)

fork_daemon()

# Now we're a fully detached daemon
while True:
    try:
        proc = subprocess.Popen(
            ['bun', 'run', 'dev'],
            cwd='/home/z/my-project/mini-services/chat-service',
            stdout=open('/home/z/my-project/chat-service.log', 'w'),
            stderr=subprocess.STDOUT,
            preexec_fn=os.setpgrp  # New process group
        )
        proc.wait()
    except:
        pass
    time.sleep(1)
