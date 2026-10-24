# Daruma DAW をローカルで開くための簡易 Web サーバー（Windows 標準の PowerShell だけで動く）
# start.bat をダブルクリックすると、これが起動してブラウザで http://localhost:8000 を開く。
# この黒い画面を閉じるとサーバーも止まる。

param([int]$Port = 8000)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) { $root += [System.IO.Path]::DirectorySeparatorChar }

$types = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".md"   = "text/plain; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
  ".mid"  = "audio/midi"
  ".midi" = "audio/midi"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  Write-Host "ポート $Port を開けませんでした。すでに起動している画面がないか確認してください。" -ForegroundColor Red
  Write-Host $_.Exception.Message
  Read-Host "Enter キーで閉じます"
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  Daruma DAW を起動しました: $url" -ForegroundColor Green
Write-Host "  Chrome か Edge で開いてください（自動で開きます）。"
Write-Host "  この画面を閉じると止まります。"
Write-Host ""
Start-Process $url

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
      if ($path -eq "/") { $path = "/index.html" }
      $full = [System.IO.Path]::GetFullPath((Join-Path $root ($path.TrimStart("/") -replace "/", "\")))
      # daw フォルダの外は見せない
      if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      } else {
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { "application/octet-stream" }
        $res.Headers.Add("Cache-Control", "no-cache")
        $bytes = [System.IO.File]::ReadAllBytes($full)
      }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("{0} {1}" -f $res.StatusCode, $path)
    } catch {
      Write-Host "エラー: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
      $res.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
