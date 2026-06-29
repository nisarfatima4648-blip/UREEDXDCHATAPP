import os, sys, time, signal, subprocess

def fork_daemon():
    if os.fork() > 0: sys.exit(0)
    os.setsid()
    if os.fork() > 0: sys.exit(0)
    os.chdir('/')
    signal.signal(signal.SIGHUP, signal.SIG_IGN)

fork_daemon()

while True:
    try:
        proc = subprocess.Popen(
            ['node', '/home/z/my-project/node_modules/.bin/next', 'dev', '-p', '3000', '--webpack'],
            cwd='/home/z/my-project',
            stdout=open('/home/z/my-project/dev.log', 'w'),
            stderr=subprocess.STDOUT,
            preexec_fn=os.setpgrp
        )
        proc.wait()
    except:
        pass
    time.sleep(1)
