@echo off
cd /d %~dp0
if not exist server\server.jar (echo FEHLT: server\server.jar - siehe README, Schritt "Minecraft-Server". & pause & exit /b 1)
if not exist mindcraft\keys.json (echo FEHLT: mindcraft\keys.json - Kopie von keys.example.json anlegen und Keys eintragen. & pause & exit /b 1)
start "Minecraft-Server" cmd /k server\start-server.bat
echo Warte bis der Server laeuft...
timeout /t 25 /nobreak >nul
start "KI-Gehirn" cmd /k "cd mindcraft && node main.js"
timeout /t 5 /nobreak >nul
start "KI-PushToTalk" cmd /k py -3.10 voice\ptt.py
