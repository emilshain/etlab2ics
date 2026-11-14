@echo off
REM Starts the ETLab -> iCalendar bridge for Thunderbird.
REM Leave this window open while you want Thunderbird to be able to refresh.
cd /d "%~dp0"
echo Starting ETLab calendar bridge on http://127.0.0.1:8787/etlab.ics
echo Close this window to stop it.
node calendar-bridge.mjs
pause
