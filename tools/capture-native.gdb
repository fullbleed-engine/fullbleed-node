set pagination off
set confirm off
set print thread-events off
set debuginfod enabled off
handle SIGPIPE nostop noprint pass
run
python
import gdb
if gdb.selected_inferior().pid:
    print('FULLBLEED_DEBUGGER_STOPPED_WITH_LIVE_INFERIOR')
    gdb.execute('thread apply all backtrace 30')
    gdb.execute('info registers')
    gdb.execute('info sharedlibrary')
else:
    print('FULLBLEED_DEBUGGER_INFERIOR_EXITED')
end
