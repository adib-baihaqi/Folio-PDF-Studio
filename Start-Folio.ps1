$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path '.venv/Scripts/python.exe')) { python -m venv .venv }
& ./.venv/Scripts/python -m pip install -r requirements.txt
Start-Process 'http://127.0.0.1:8765'
& ./.venv/Scripts/python -m uvicorn server:app --host 127.0.0.1 --port 8765
