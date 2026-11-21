# Crea la tarea "TableroFinanciero-Recarga" (cada 15 min; el recolector filtra lun-vie 09-20 hora Argentina).
# Uso:  powershell -ExecutionPolicy Bypass -File .\programar_tarea.ps1   (quitar: agregar -Quitar)
param([switch]$Quitar, [int]$Minutos = 15)
$dir = $PSScriptRoot
if ($Quitar) { Unregister-ScheduledTask -TaskName "TableroFinanciero-Recarga" -Confirm:$false -ErrorAction SilentlyContinue; "Tarea eliminada"; return }
$node = (Get-Command node -ErrorAction Stop).Source
$accion = New-ScheduledTaskAction -Execute $node -Argument "collector.mjs --programado" -WorkingDirectory $dir
$trig = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes $Minutos) -RepetitionDuration (New-TimeSpan -Days 3650)
$conf = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName "TableroFinanciero-Recarga" -Action $accion -Trigger $trig -Settings $conf -Force | Out-Null
"Listo: recarga cada $Minutos min (solo lun-vie 09-20 hora Argentina)."
