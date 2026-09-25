param(
    [string]$RepositoryRoot = "C:\TipIn"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$navy = [System.Drawing.Color]::FromArgb(255, 11, 20, 36)
$white = [System.Drawing.Color]::FromArgb(255, 232, 237, 245)
$orange = [System.Drawing.Color]::FromArgb(255, 255, 123, 0)
$transparent = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)

function New-TipInMarkBitmap {
    param(
        [int]$Size,
        [ValidateSet("Transparent", "Circle", "Square", "Monochrome")]
        [string]$Variant,
        [double]$Scale = 1.0
    )

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear($(if ($Variant -eq "Square") { $navy } else { $transparent }))

    $unit = ($Size / 128.0) * $Scale
    $offset = ($Size - (128.0 * $unit)) / 2.0
    function P([double]$value) { return [single]($offset + ($value * $unit)) }

    if ($Variant -eq "Circle") {
        $navyBrush = New-Object System.Drawing.SolidBrush($navy)
        $graphics.FillEllipse($navyBrush, (P 4), (P 4), [single](120 * $unit), [single](120 * $unit))
        $navyBrush.Dispose()
    }

    $markColor = if ($Variant -eq "Monochrome") { $white } else { $white }
    $innerColor = if ($Variant -eq "Monochrome") { $white } else { $orange }
    $ringPenOuter = New-Object System.Drawing.Pen($markColor, [single](4 * $unit))
    $ringPenInner = New-Object System.Drawing.Pen($markColor, [single](2 * $unit))
    $ringPenOuter.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $ringPenInner.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawEllipse($ringPenOuter, (P 6), (P 6), [single](116 * $unit), [single](116 * $unit))
    $graphics.DrawEllipse($ringPenInner, (P 14), (P 14), [single](100 * $unit), [single](100 * $unit))

    $tPoints = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new((P 27), (P 34)),
        [System.Drawing.PointF]::new((P 97), (P 34)),
        [System.Drawing.PointF]::new((P 92), (P 51)),
        [System.Drawing.PointF]::new((P 70), (P 51)),
        [System.Drawing.PointF]::new((P 56), (P 96)),
        [System.Drawing.PointF]::new((P 37), (P 96)),
        [System.Drawing.PointF]::new((P 51), (P 51)),
        [System.Drawing.PointF]::new((P 22), (P 51))
    )
    $iPoints = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new((P 75), (P 55)),
        [System.Drawing.PointF]::new((P 94), (P 55)),
        [System.Drawing.PointF]::new((P 81), (P 96)),
        [System.Drawing.PointF]::new((P 62), (P 96))
    )

    $tBrush = New-Object System.Drawing.SolidBrush($markColor)
    $iBrush = New-Object System.Drawing.SolidBrush($innerColor)
    $graphics.FillPolygon($tBrush, $tPoints)
    $graphics.FillPolygon($iBrush, $iPoints)

    $tBrush.Dispose()
    $iBrush.Dispose()
    $ringPenOuter.Dispose()
    $ringPenInner.Dispose()
    $graphics.Dispose()
    return $bitmap
}

function Save-TipInPng {
    param(
        [string]$Path,
        [int]$Size,
        [string]$Variant,
        [double]$Scale = 1.0
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $bitmap = New-TipInMarkBitmap -Size $Size -Variant $Variant -Scale $Scale
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
}

function Save-TipInJpeg {
    param(
        [string]$Path,
        [int]$Size = 1024,
        [double]$Scale = 0.86
    )

    $bitmap = New-TipInMarkBitmap -Size $Size -Variant "Square" -Scale $Scale
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bitmap.Dispose()
}

function Save-TipInIco {
    param(
        [string]$Path,
        [int[]]$Sizes = @(16, 24, 32, 48, 64, 128, 256)
    )

    $frames = foreach ($size in $Sizes) {
        $bitmap = New-TipInMarkBitmap -Size $size -Variant "Circle" -Scale 0.9
        $stream = New-Object System.IO.MemoryStream
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
        $bytes = $stream.ToArray()
        $stream.Dispose()
        [pscustomobject]@{ Size = $size; Bytes = $bytes }
    }

    $output = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($output)
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$frames.Count)

    $offset = 6 + (16 * $frames.Count)
    foreach ($frame in $frames) {
        $dimension = if ($frame.Size -eq 256) { 0 } else { $frame.Size }
        $writer.Write([byte]$dimension)
        $writer.Write([byte]$dimension)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$frame.Bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $frame.Bytes.Length
    }

    foreach ($frame in $frames) {
        $writer.Write($frame.Bytes)
    }

    $writer.Flush()
    [System.IO.File]::WriteAllBytes($Path, $output.ToArray())
    $writer.Dispose()
    $output.Dispose()
}

$adminAssets = Join-Path $RepositoryRoot "web\admin-portal\assets"
$gameViewAssets = Join-Path $RepositoryRoot "web\game-view\assets"
$gameViewPublic = Join-Path $RepositoryRoot "web\game-view\public"
$mobileAssets = Join-Path $RepositoryRoot "mobile\game-manager-mobile\assets"
$apiAssets = Join-Path $RepositoryRoot "api\TipInAPI\Assets"
$bridgeRoot = Join-Path $RepositoryRoot "TipInBridgeApp"

Save-TipInPng (Join-Path $adminAssets "TipIn NoBG.png") 1024 "Transparent"
Save-TipInPng (Join-Path $adminAssets "TipIn_Default_Logo.png") 1024 "Square" 0.86
Save-TipInJpeg (Join-Path $adminAssets "TipIn_Default_Logo.jpg")
Save-TipInPng (Join-Path $gameViewPublic "TipIn_Mark.png") 1024 "Circle"
Save-TipInPng (Join-Path $gameViewPublic "TipIn_Header_Icon.png") 442 "Circle"
Save-TipInPng (Join-Path $gameViewPublic "TipIn NoBG.png") 1024 "Transparent"
Save-TipInPng (Join-Path $gameViewPublic "TipIn_Default_Logo.png") 1024 "Square" 0.86
Save-TipInJpeg (Join-Path $gameViewPublic "TipIn_Default_Logo.jpg")
Save-TipInPng (Join-Path $gameViewPublic "TipIn_GameView_Icon.png") 512 "Square" 0.82
Save-TipInPng (Join-Path $gameViewAssets "TipIn NoBG.png") 1024 "Transparent"
Save-TipInPng (Join-Path $gameViewAssets "TipIn_Default_Logo.png") 1024 "Square" 0.86
Save-TipInJpeg (Join-Path $gameViewAssets "TipIn_Default_Logo.jpg")
Save-TipInPng (Join-Path $apiAssets "TipIn NoBG.png") 1024 "Circle"
Save-TipInPng (Join-Path $apiAssets "TipIn_Default_Logo.png") 1024 "Circle"
Save-TipInPng (Join-Path $apiAssets "TipIn-logo.png") 1024 "Circle"
Save-TipInPng (Join-Path $mobileAssets "TipIn NoBG.png") 1024 "Transparent"
Save-TipInPng (Join-Path $mobileAssets "TipIn_Default_Logo.png") 1024 "Square" 0.86
Save-TipInJpeg (Join-Path $mobileAssets "TipIn_Default_Logo.jpg")
Save-TipInPng (Join-Path $mobileAssets "icon.png") 1024 "Square" 0.86
Save-TipInPng (Join-Path $mobileAssets "android-icon-foreground.png") 1024 "Transparent" 0.66
Save-TipInPng (Join-Path $mobileAssets "android-icon-background.png") 1024 "Square" 0.0
Save-TipInPng (Join-Path $mobileAssets "android-icon-monochrome.png") 432 "Monochrome" 0.66
Save-TipInPng (Join-Path $mobileAssets "ic_launcher_background.png") 432 "Square" 0.0
Save-TipInPng (Join-Path $mobileAssets "ic_launcher_monochrome.png") 432 "Monochrome" 0.66
Save-TipInPng (Join-Path $mobileAssets "favicon.png") 192 "Square" 0.82

$icoTargets = @(
    (Join-Path $adminAssets "favicon.ico"),
    (Join-Path $gameViewPublic "favicon.ico"),
    (Join-Path $RepositoryRoot "web\favicon.ico"),
    (Join-Path $mobileAssets "favicon.ico"),
    (Join-Path $bridgeRoot "favicon.ico")
)

foreach ($icoTarget in $icoTargets) {
    Save-TipInIco -Path $icoTarget
}

Write-Output "Generated TipIn brand assets from the canonical simplified mark."
