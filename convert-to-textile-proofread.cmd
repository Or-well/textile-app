@echo off
setlocal
chcp 65001 >nul

set "TEXTILE_CONVERTER_SOURCE=%~f0"
set "TEXTILE_CONVERTER_TEMP=%TEMP%\%~n0-%RANDOM%-%RANDOM%.ps1"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$source = [IO.File]::ReadAllText($env:TEXTILE_CONVERTER_SOURCE); $marker = '# __POWERSHELL__'; $position = $source.LastIndexOf($marker, [StringComparison]::Ordinal); if ($position -lt 0) { throw 'Converter payload is missing.' }; $code = $source.Substring($position + $marker.Length); [IO.File]::WriteAllText($env:TEXTILE_CONVERTER_TEMP, $code, [Text.UTF8Encoding]::new($false))"
if errorlevel 1 goto :failed

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TEXTILE_CONVERTER_TEMP%" -Mode proofread %*
set "TEXTILE_CONVERTER_EXIT=%ERRORLEVEL%"
del /q "%TEXTILE_CONVERTER_TEMP%" >nul 2>&1

echo.
if not "%TEXTILE_CONVERTER_EXIT%"=="0" goto :failed_without_cleanup
echo Conversion completed. Press any key to close.
pause >nul
exit /b 0

:failed
del /q "%TEXTILE_CONVERTER_TEMP%" >nul 2>&1

:failed_without_cleanup
echo.
echo Conversion failed. Check the error above, then press any key to close.
pause >nul
exit /b 1

# __POWERSHELL__
param(
  [ValidateSet("translated", "proofread")]
  [string]$Mode,

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$InputPaths
)

$ErrorActionPreference = "Stop"

function Read-SourceText {
  param([string]$Path)

  $bytes = [IO.File]::ReadAllBytes($Path)

  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    return [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  }

  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
    return [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2)
  }

  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) {
    return [Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2)
  }

  try {
    return [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
  } catch {
    return [Text.Encoding]::Default.GetString($bytes)
  }
}

function Split-EntryPayload {
  param(
    [string]$Payload,
    [char]$Delimiter
  )

  $delimiterIndex = $Payload.IndexOf($Delimiter)
  if ($delimiterIndex -lt 0) {
    return [pscustomobject]@{
      Speaker = ""
      Text = $Payload
    }
  }

  return [pscustomobject]@{
    Speaker = $Payload.Substring(0, $delimiterIndex)
    Text = $Payload.Substring($delimiterIndex + 1)
  }
}

function New-OutputDirectory {
  param(
    [string]$ParentDirectory,
    [string]$Label
  )

  $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $baseName = "Textile_JSON_${Label}_${timestamp}"
  $candidate = Join-Path $ParentDirectory $baseName
  $suffix = 2

  while (Test-Path -LiteralPath $candidate) {
    $candidate = Join-Path $ParentDirectory "${baseName}_$suffix"
    $suffix++
  }

  [IO.Directory]::CreateDirectory($candidate) | Out-Null
  return $candidate
}

function Convert-SourceFile {
  param(
    [string]$Path,
    [string]$OutputDirectory,
    [string]$TargetStatus
  )

  $text = Read-SourceText -Path $Path
  $sourceRows = [Collections.Generic.List[object]]::new()
  $sourceIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  $targetRows = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
  $lineNumber = 0

  foreach ($line in [Text.RegularExpressions.Regex]::Split($text, "\r\n|\n|\r")) {
    $lineNumber++
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    if ($line -match "^☆(\d{6})☆(.*)$") {
      $entryId = $Matches[1]
      if (-not $sourceIds.Add($entryId)) {
        throw "$Path 第 $lineNumber 行存在重复原文编号 $entryId。"
      }

      $sourceRows.Add([pscustomobject]@{
        Id = $entryId
        Payload = $Matches[2]
      })
      continue
    }

    if ($line -match "^★(\d{6})★(.*)$") {
      $entryId = $Matches[1]
      if ($targetRows.ContainsKey($entryId)) {
        throw "$Path 第 $lineNumber 行存在重复译文编号 $entryId。"
      }

      $targetRows.Add($entryId, $Matches[2])
      continue
    }

    throw "$Path 第 $lineNumber 行不是支持的 ☆编号☆原文 或 ★编号★译文 格式。"
  }

  if ($sourceRows.Count -eq 0) {
    throw "$Path 没有找到原文词条。"
  }

  foreach ($targetId in $targetRows.Keys) {
    if (-not $sourceIds.Contains($targetId)) {
      throw "$Path 的译文编号 $targetId 没有对应原文。"
    }
  }

  $result = [Collections.Generic.List[object]]::new()
  $index = 0

  foreach ($sourceRow in $sourceRows) {
    $index++
    $source = Split-EntryPayload -Payload $sourceRow.Payload -Delimiter ([char]"☆")
    $hasTargetRow = $targetRows.ContainsKey($sourceRow.Id)
    $target = if ($hasTargetRow) {
      Split-EntryPayload -Payload ([string]$targetRows[$sourceRow.Id]) -Delimiter ([char]"★")
    } else {
      [pscustomobject]@{ Speaker = ""; Text = "" }
    }

    $hasTranslation = -not [string]::IsNullOrWhiteSpace($target.Text)
    $speaker = if ($hasTranslation -and $target.Speaker) {
      $target.Speaker
    } else {
      $source.Speaker
    }
    $context = if ($hasTranslation -and $source.Speaker -and $speaker -ne $source.Speaker) {
      "原文说话人：$($source.Speaker)"
    } else {
      ""
    }

    $status = if ($hasTranslation) { $TargetStatus } else { "untranslated" }
    $proofreadCount = if ($hasTranslation -and $TargetStatus -eq "proofread") { 1 } else { 0 }

    $result.Add([ordered]@{
      key = $sourceRow.Id
      index = $index
      speaker = $speaker
      source = $source.Text
      target = if ($hasTranslation) { $target.Text } else { "" }
      context = $context
      status = $status
      translated_by = ""
      proofread_count = $proofreadCount
      proofread_by = @()
      reviewed_by = ""
    })
  }

  $outputName = [IO.Path]::GetFileNameWithoutExtension($Path) + ".json"
  $outputPath = Join-Path $OutputDirectory $outputName
  $json = ConvertTo-Json -InputObject @($result) -Depth 5
  [IO.File]::WriteAllText($outputPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

  Write-Host "已生成：$outputPath（$($result.Count) 条）"
}

try {
  if (-not $InputPaths -or $InputPaths.Count -eq 0) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = [Windows.Forms.OpenFileDialog]::new()
    $dialog.Title = "选择要转换的文本文件"
    $dialog.Filter = "文本文件 (*.txt)|*.txt|所有文件 (*.*)|*.*"
    $dialog.Multiselect = $true

    if ($dialog.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) {
      Write-Host "已取消。"
      exit 0
    }

    $InputPaths = $dialog.FileNames
  }

  $resolvedPaths = [Collections.Generic.List[string]]::new()
  $seenPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

  foreach ($inputPath in $InputPaths) {
    $resolved = (Resolve-Path -LiteralPath $inputPath -ErrorAction Stop).Path
    if (-not [IO.File]::Exists($resolved)) {
      throw "只支持拖入文件：$inputPath"
    }
    if ([IO.Path]::GetExtension($resolved) -ne ".txt") {
      throw "只支持 .txt 文件：$resolved"
    }
    if ($seenPaths.Add($resolved)) {
      $resolvedPaths.Add($resolved)
    }
  }

  $label = if ($Mode -eq "proofread") { "已校对" } else { "已翻译" }
  $targetStatus = if ($Mode -eq "proofread") { "proofread" } else { "translated" }
  $outputDirectories = @{}

  foreach ($path in $resolvedPaths) {
    $parent = [IO.Path]::GetDirectoryName($path)
    if (-not $outputDirectories.ContainsKey($parent)) {
      $outputDirectories[$parent] = New-OutputDirectory -ParentDirectory $parent -Label $label
    }

    Convert-SourceFile -Path $path -OutputDirectory $outputDirectories[$parent] -TargetStatus $targetStatus
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
