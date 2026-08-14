@echo off
REM MedyaAtlas sabit yollar — diger bat'lar bunu call eder.
REM Asil calisma yeri Google Drive DEGIL, yerel disk:

if not defined MA_BRANCH set "MA_BRANCH=cursor/recognize-all-media-6bc2"
if not defined MA_EXPECT set "MA_EXPECT=0.6.6"
if not defined MA_LOCAL set "MA_LOCAL=C:\src\MedyaAtlas"
if not defined MA_REMOTE_DEFAULT set "MA_REMOTE_DEFAULT=https://github.com/alid67-git/MedyaAtlas.git"
