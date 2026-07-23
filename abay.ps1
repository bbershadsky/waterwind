#Requires -Version 5.1
<#
.SYNOPSIS
  Canoe briefing for Abino Bay, Lake Erie (Point Abino / Fort Erie, ON).

.DESCRIPTION
  Pulls live free/no-key sources and prints canoe-relevant conditions:
    - Open-Meteo forecast (wind, gusts, precip, sky)
    - Open-Meteo marine (wave height / period)
    - Environment Canada marine forecast + warnings (Eastern Lake Erie)
    - Environment Canada weather alerts (area bbox)
    - NDBC realtime buoys (Port Colborne 45142, Buffalo 4403586)

  AccuWeather and Surfline are not free/keyless; they are omitted.
  Guidance is informal decision support only - not a substitute for
  local marine forecasts, your own judgment, or PFD use.

.EXAMPLE
  .\abino-bay-canoe.ps1
#>
[CmdletBinding()]
param(
    [double]$Latitude = 42.854444,
    [double]$Longitude = -79.078333,
    [int]$TimeoutSec = 20
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$SiteName = 'Abino Bay, Lake Erie (ON)'
$UserAgent = 'AbinoBayCanoeBrief/1.0 (+local; canoe planning)'
$Tz = 'America/Toronto'

function Get-Json {
    param([Parameter(Mandatory)][string]$Uri, [hashtable]$Headers = @{})
    $hdr = @{ 'User-Agent' = $UserAgent } + $Headers
    return Invoke-RestMethod -Uri $Uri -Headers $hdr -TimeoutSec $TimeoutSec
}

function Get-Text {
    param([Parameter(Mandatory)][string]$Uri)
    $resp = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $TimeoutSec -Headers @{ 'User-Agent' = $UserAgent }
    return $resp.Content
}

function Get-Compass {
    param([AllowNull()][Nullable[double]]$Degrees)
    if ($null -eq $Degrees) { return 'n/a' }
    $dirs = @('N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW')
    $i = [int]([math]::Floor((($Degrees % 360) + 11.25) / 22.5)) % 16
    return $dirs[$i]
}

function Get-WmoSky {
    param([AllowNull()][Nullable[int]]$Code)
    switch ($Code) {
        0 { 'Clear' }
        1 { 'Mainly clear' }
        2 { 'Partly cloudy' }
        3 { 'Overcast' }
        45 { 'Fog' }
        48 { 'Depositing rime fog' }
        51 { 'Light drizzle' }
        53 { 'Drizzle' }
        55 { 'Dense drizzle' }
        61 { 'Light rain' }
        63 { 'Rain' }
        65 { 'Heavy rain' }
        71 { 'Light snow' }
        73 { 'Snow' }
        75 { 'Heavy snow' }
        80 { 'Light showers' }
        81 { 'Showers' }
        82 { 'Heavy showers' }
        95 { 'Thunderstorm' }
        96 { 'Thunderstorm + hail' }
        99 { 'Thunderstorm + heavy hail' }
        default { if ($null -eq $Code) { 'n/a' } else { "WMO $Code" } }
    }
}

function ConvertFrom-MsToKmh {
    param([AllowNull()][Nullable[double]]$Ms)
    if ($null -eq $Ms) { return $null }
    return [math]::Round($Ms * 3.6, 1)
}

function Get-EnText {
    param($Node)
    if ($null -eq $Node) { return $null }
    if ($Node -is [string]) { return $Node }
    if ($Node.PSObject.Properties.Name -contains 'en') { return [string]$Node.en }
    return [string]$Node
}

function Format-Num {
    param($Value, [string]$Suffix = '', [string]$Missing = 'n/a', [int]$Digits = 1)
    if ($null -eq $Value -or $Value -eq '' -or $Value -eq 'MM') { return $Missing }
    try {
        $n = [double]$Value
        if ([double]::IsNaN($n)) { return $Missing }
        return ("{0:N$Digits}{1}" -f $n, $Suffix)
    } catch {
        return $Missing
    }
}

function Get-CanoeGuidance {
    param(
        [AllowNull()][Nullable[double]]$WindKmh,
        [AllowNull()][Nullable[double]]$GustKmh,
        [AllowNull()][Nullable[double]]$WaveM,
        [bool]$MarineWarning
    )

    $gust = if ($null -ne $GustKmh) { $GustKmh } else { $WindKmh }
    $wave = if ($null -ne $WaveM) { $WaveM } else { 0 }

    if ($MarineWarning -or ($null -ne $gust -and $gust -ge 40) -or $wave -ge 1.0) {
        return @{
            Rank = 'AVOID'
            Detail = 'Strong gusts, whitecaps likely, and/or active marine warning. Stay ashore or pick a fully sheltered inland route.'
        }
    }
    if (($null -ne $gust -and $gust -ge 25) -or $wave -ge 0.5) {
        return @{
            Rank = 'MARGINAL'
            Detail = 'Some gusts or exposed shoreline chop. Prefer lee of Point Abino / Abino Bay pocket; keep exit plan ready.'
        }
    }
    return @{
        Rank = 'GOOD'
        Detail = 'Light wind, low chop, sheltered route favored. Still wear a PFD and watch lake breeze build mid-afternoon.'
    }
}

function Parse-NdbcLatest {
    param([Parameter(Mandatory)][string]$StationId, [string]$Label, [double]$DistanceKm)

    $raw = Get-Text "https://www.ndbc.noaa.gov/data/realtime2/$StationId.txt"
    $lines = $raw -split '\r?\n' | Where-Object { $_ -and ($_ -notmatch '^\s*$') }
    if ($lines.Count -lt 3) { throw "NDBC $StationId returned no data rows" }

    # Positional parse: NDBC headers collide under case-insensitive hashtables (MM vs mm).
    $row = $lines[2].Trim() -split '\s+'
    if ($row.Count -lt 15) { throw "NDBC $StationId row too short" }

    function Cell([int]$Index) {
        if ($Index -ge $row.Count -or $row[$Index] -eq 'MM') { return $null }
        return $row[$Index]
    }

    $yy = Cell 0; $mo = Cell 1; $dd = Cell 2; $hh = Cell 3; $mn = Cell 4
    $wdir = Cell 5; $wspd = Cell 6; $gst = Cell 7; $wvht = Cell 8; $dpd = Cell 9
    $atmp = Cell 13; $wtmp = Cell 14; $pres = Cell 12

    $obsUtc = if ($yy -and $mo -and $dd -and $hh) {
        '{0}-{1:D2}-{2:D2} {3:D2}:{4:D2} UTC' -f $yy, [int]$mo, [int]$dd, [int]$hh, $(if ($mn) { [int]$mn } else { 0 })
    } else { 'n/a' }

    return [pscustomobject]@{
        Station    = $StationId
        Label      = $Label
        DistanceKm = $DistanceKm
        Observed   = $obsUtc
        WindDir    = if ($wdir) { '{0} {1}' -f $wdir, (Get-Compass ([double]$wdir)) } else { 'n/a' }
        WindKmh    = Format-Num (ConvertFrom-MsToKmh $(if ($wspd) { [double]$wspd } else { $null })) ' km/h'
        GustKmh    = Format-Num (ConvertFrom-MsToKmh $(if ($gst) { [double]$gst } else { $null })) ' km/h'
        WaveM      = Format-Num $(if ($wvht) { [double]$wvht } else { $null }) ' m'
        PeriodS    = Format-Num $(if ($dpd) { [double]$dpd } else { $null }) ' s' -Digits 0
        AirC       = Format-Num $(if ($atmp) { [double]$atmp } else { $null }) ' C'
        WaterC     = Format-Num $(if ($wtmp) { [double]$wtmp } else { $null }) ' C'
        Pressure   = Format-Num $(if ($pres) { [double]$pres } else { $null }) ' hPa' -Digits 1
        WindKmhRaw = ConvertFrom-MsToKmh $(if ($wspd) { [double]$wspd } else { $null })
        GustKmhRaw = ConvertFrom-MsToKmh $(if ($gst) { [double]$gst } else { $null })
        WaveMRaw   = if ($wvht) { [double]$wvht } else { $null }
    }
}

Write-Host ''
Write-Host ('=' * 72)
Write-Host " ABINO BAY CANOE BRIEF  |  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') local"
Write-Host " $SiteName"
Write-Host (" {0:N5} N, {1:N5} W" -f $Latitude, [math]::Abs($Longitude))
Write-Host ('=' * 72)

$errors = New-Object System.Collections.Generic.List[string]
$wx = $null
$marine = $null
$ecMarine = $null
$ecAlerts = @()
$buoys = @()

# --- Open-Meteo land forecast ---
try {
    $wxUrl = "https://api.open-meteo.com/v1/forecast?latitude=$Latitude&longitude=$Longitude" +
        '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
        '&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code' +
        '&daily=sunrise,sunset,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max' +
        "&forecast_days=2&timezone=$Tz&wind_speed_unit=kmh"
    $wx = Get-Json $wxUrl
} catch {
    $errors.Add("Open-Meteo forecast: $($_.Exception.Message)")
}

# --- Open-Meteo marine ---
try {
    $marineUrl = "https://marine-api.open-meteo.com/v1/marine?latitude=$Latitude&longitude=$Longitude" +
        '&current=wave_height,wave_direction,wave_period,wind_wave_height' +
        '&hourly=wave_height,wave_direction,wave_period,wind_wave_height' +
        "&forecast_days=2&timezone=$Tz&length_unit=metric&cell_selection=sea"
    $marine = Get-Json $marineUrl
} catch {
    $errors.Add("Open-Meteo marine: $($_.Exception.Message)")
}

# --- Environment Canada marine (Lake Erie = m0000052) ---
try {
    $ecMarine = (Get-Json 'https://api.weather.gc.ca/collections/marineweather-realtime/items/m0000052?f=json').properties
} catch {
    $errors.Add("EC marine: $($_.Exception.Message)")
}

# --- Environment Canada alerts near Abino Bay ---
try {
    $bbox = '{0},{1},{2},{3}' -f ($Longitude - 0.35), ($Latitude - 0.25), ($Longitude + 0.35), ($Latitude + 0.25)
    $alertDoc = Get-Json "https://api.weather.gc.ca/collections/weather-alerts/items?f=json&bbox=$bbox&limit=25"
    if ($alertDoc.features) { $ecAlerts = @($alertDoc.features) }
} catch {
    $errors.Add("EC alerts: $($_.Exception.Message)")
}

# --- NDBC buoys ---
$buoyDefs = @(
    @{ Id = '45142'; Label = 'Port Colborne (ECCC/NDBC)'; Km = 21.5 }
    @{ Id = '4403586'; Label = 'Buffalo Buoy (nearshore)'; Km = 14.2 }
)
foreach ($b in $buoyDefs) {
    try {
        $buoys += Parse-NdbcLatest -StationId $b.Id -Label $b.Label -DistanceKm $b.Km
    } catch {
        $errors.Add("NDBC $($b.Id): $($_.Exception.Message)")
    }
}

# ---------- CURRENT CONDITIONS ----------
Write-Host ''
Write-Host 'CURRENT - Open-Meteo (model)'
Write-Host ('-' * 72)
if ($wx -and $wx.current) {
    $c = $wx.current
    Write-Host ("  As of:          {0} ({1})" -f $c.time, $wx.timezone)
    Write-Host ("  Air:            {0} C  (feels {1} C)  RH {2}%" -f $c.temperature_2m, $c.apparent_temperature, $c.relative_humidity_2m)
    Write-Host ("  Sky:            {0}  |  cloud {1}%  |  precip {2} mm" -f (Get-WmoSky $c.weather_code), $c.cloud_cover, $c.precipitation)
    Write-Host ("  Wind:           {0} km/h {1} ({2} deg)  gusts {3} km/h" -f `
        $c.wind_speed_10m, (Get-Compass $c.wind_direction_10m), $c.wind_direction_10m, $c.wind_gusts_10m)
} else {
    Write-Host '  (unavailable)'
}

Write-Host ''
Write-Host 'WAVES - Open-Meteo Marine (model at nearest lake cell)'
Write-Host ('-' * 72)
if ($marine -and $marine.current) {
    $m = $marine.current
    # Lake cells sometimes omit "current" wave height; fall back to nearest hourly sample.
    $waveH = $m.wave_height
    $waveP = $m.wave_period
    $windWave = $m.wind_wave_height
    if (($null -eq $waveH -or $waveH -eq '') -and $marine.hourly -and $marine.hourly.wave_height) {
        for ($hi = 0; $hi -lt $marine.hourly.time.Count; $hi++) {
            if ($null -ne $marine.hourly.wave_height[$hi]) {
                $waveH = $marine.hourly.wave_height[$hi]
                $waveP = $marine.hourly.wave_period[$hi]
                $windWave = $marine.hourly.wind_wave_height[$hi]
                if ($null -eq $m.wave_direction -and $marine.hourly.wave_direction) {
                    $m | Add-Member -NotePropertyName wave_direction -NotePropertyValue $marine.hourly.wave_direction[$hi] -Force
                }
                break
            }
        }
    }
    Write-Host ("  As of:          {0}" -f $m.time)
    Write-Host ("  Wave height:    {0} m   wind-wave {1} m" -f (Format-Num $waveH), (Format-Num $windWave))
    Write-Host ("  Wave dir/per:   {0} ({1} deg)  |  period {2} s" -f `
        (Get-Compass $m.wave_direction), (Format-Num $m.wave_direction -Digits 0), (Format-Num $waveP))
    if ($marine.latitude) {
        Write-Host ("  Model cell:     {0:N3}, {1:N3}" -f $marine.latitude, $marine.longitude)
    }
} else {
    Write-Host '  (unavailable)'
}

# ---------- BUOYS ----------
Write-Host ''
Write-Host 'NEARBY BUOYS - NDBC realtime'
Write-Host ('-' * 72)
if ($buoys.Count -eq 0) {
    Write-Host '  (unavailable)'
} else {
    $buoyRows = $buoys | ForEach-Object {
        [pscustomobject]@{
            Station  = $_.Station
            Label    = $_.Label
            'Dist km'= $_.DistanceKm
            Observed = $_.Observed
            Wind     = $_.WindDir
            'Wind km/h' = $_.WindKmh
            Gust     = $_.GustKmh
            Wave     = $_.WaveM
            Period   = $_.PeriodS
            Air      = $_.AirC
            Water    = $_.WaterC
        }
    }
    $buoyRows | Format-Table -AutoSize | Out-String | Write-Host
}

# ---------- EC MARINE ----------
Write-Host 'ENVIRONMENT CANADA - Lake Erie marine'
Write-Host ('-' * 72)
$hasMarineWarning = $false
if ($ecMarine) {
    Write-Host ("  Updated:        {0}" -f $ecMarine.lastUpdated)

    $warnLocs = @($ecMarine.warnings.locations)
    $eastWarn = $warnLocs | Where-Object {
        $n = Get-EnText $_.name
        $n -match 'Eastern Lake Erie' -or $n -match 'Erie Est'
    }
    if (-not $eastWarn) {
        # fallback: any Lake Erie warning that mentions Eastern
        $eastWarn = $warnLocs | Where-Object { (Get-EnText $_.name) -match 'Eastern' }
    }

    if ($eastWarn) {
        foreach ($loc in @($eastWarn)) {
            $locName = Get-EnText $loc.name
            foreach ($ev in @($loc.events)) {
                $hasMarineWarning = $true
                Write-Host ("  WARNING:       {0} - {1} [{2}]" -f $locName, (Get-EnText $ev.name), (Get-EnText $ev.status))
            }
        }
    } else {
        Write-Host '  Warnings:      none for Eastern Lake Erie'
    }

    $eastWind = @($ecMarine.regularForecast.locations) | Where-Object {
        $_.name -match 'Est$' -or $_.name -match 'East' -or (Get-EnText $_.name) -match 'Eastern'
    } | Select-Object -First 1
    if (-not $eastWind -and $ecMarine.regularForecast.locations) {
        $eastWind = $ecMarine.regularForecast.locations | Where-Object { $_.name -like '*Est*' -and $_.name -notlike '*Ouest*' } | Select-Object -First 1
    }
    if ($eastWind) {
        $wc = $eastWind.weatherCondition
        Write-Host ("  Area:          {0}" -f $(if ($eastWind.name) { $eastWind.name } else { 'Eastern Lake Erie' }))
        Write-Host ("  Period:        {0}" -f (Get-EnText $wc.periodOfCoverage))
        Write-Host ("  Wind:          {0}" -f (Get-EnText $wc.wind))
        if ($wc.weatherVisibility) {
            Write-Host ("  Weather:       {0}" -f (Get-EnText $wc.weatherVisibility))
        }
    }

    $eastWave = @($ecMarine.waveForecast.locations) | Where-Object {
        $_.name -match 'Est$' -or ($_.name -like '*Est*' -and $_.name -notlike '*Ouest*')
    } | Select-Object -First 1
    if ($eastWave) {
        Write-Host ("  Waves (EC):    {0}" -f (Get-EnText $eastWave.weatherCondition.textSummary))
    }

    $ext = @($ecMarine.extendedForecast.locations) | Select-Object -First 1
    if ($ext -and $ext.weatherCondition.forecastPeriods) {
        Write-Host '  Extended:'
        foreach ($p in @($ext.weatherCondition.forecastPeriods)) {
            Write-Host ("    {0}: {1}" -f (Get-EnText $p.name), (Get-EnText $p.value))
        }
    }
} else {
    Write-Host '  (unavailable)'
}

# ---------- EC ALERTS ----------
Write-Host ''
Write-Host 'ENVIRONMENT CANADA - weather alerts (local bbox)'
Write-Host ('-' * 72)
if ($ecAlerts.Count -eq 0) {
    Write-Host '  No active alerts in the Abino Bay bbox.'
} else {
    foreach ($f in $ecAlerts) {
        $p = $f.properties
        $headline = Get-EnText $p.headline
        if (-not $headline) { $headline = Get-EnText $p.name }
        $sev = Get-EnText $p.severity
        Write-Host ("  * [{0}] {1}" -f $(if ($sev) { $sev } else { 'alert' }), $headline)
    }
}

# ---------- NEXT HOURS ----------
Write-Host ''
Write-Host 'NEXT 12 HOURS - wind / waves / rain chance'
Write-Host ('-' * 72)
$hourlyRows = @()
if ($wx -and $wx.hourly -and $wx.hourly.time) {
    $now = Get-Date
    $count = 0
    for ($i = 0; $i -lt $wx.hourly.time.Count -and $count -lt 12; $i++) {
        $t = [datetime]::Parse($wx.hourly.time[$i])
        if ($t -lt $now.AddMinutes(-30)) { continue }

        $waveH = $null
        $waveP = $null
        if ($marine -and $marine.hourly -and $marine.hourly.time) {
            $mi = [array]::IndexOf(@($marine.hourly.time), $wx.hourly.time[$i])
            if ($mi -ge 0) {
                $waveH = $marine.hourly.wave_height[$mi]
                $waveP = $marine.hourly.wave_period[$mi]
            }
        }

        $hourlyRows += [pscustomobject]@{
            Time     = $t.ToString('ddd HH:mm')
            TempC    = $wx.hourly.temperature_2m[$i]
            'Wind'   = '{0} {1}' -f $wx.hourly.wind_speed_10m[$i], (Get-Compass $wx.hourly.wind_direction_10m[$i])
            Gust     = $wx.hourly.wind_gusts_10m[$i]
            'Wave m' = if ($null -ne $waveH) { [math]::Round([double]$waveH, 2) } else { $null }
            'Per s'  = if ($null -ne $waveP) { [math]::Round([double]$waveP, 1) } else { $null }
            'Rain %' = $wx.hourly.precipitation_probability[$i]
            Sky      = Get-WmoSky $wx.hourly.weather_code[$i]
        }
        $count++
    }
}
if ($hourlyRows.Count -gt 0) {
    $hourlyRows | Format-Table -AutoSize | Out-String | Write-Host
} else {
    Write-Host '  (hourly unavailable)'
}

# ---------- DAY SUMMARY ----------
if ($wx -and $wx.daily) {
    Write-Host 'TODAY / TOMORROW'
    Write-Host ('-' * 72)
    for ($d = 0; $d -lt [math]::Min(2, $wx.daily.time.Count); $d++) {
        Write-Host ("  {0}: sunrise {1}  sunset {2}  |  rain {3} mm  |  max wind {4} / gusts {5} km/h" -f `
            $wx.daily.time[$d],
            ($wx.daily.sunrise[$d] -replace '.*T', ''),
            ($wx.daily.sunset[$d] -replace '.*T', ''),
            $wx.daily.precipitation_sum[$d],
            $wx.daily.wind_speed_10m_max[$d],
            $wx.daily.wind_gusts_10m_max[$d])
    }
}

# ---------- GUIDANCE ----------
$windNow = if ($wx -and $wx.current) { [double]$wx.current.wind_speed_10m } else { $null }
$gustNow = if ($wx -and $wx.current) { [double]$wx.current.wind_gusts_10m } else { $null }
$waveNow = if ($marine -and $marine.current -and $null -ne $marine.current.wave_height) { [double]$marine.current.wave_height } else { $null }

# Prefer buoy observations when available
foreach ($b in $buoys) {
    if ($null -ne $b.GustKmhRaw -and ($null -eq $gustNow -or $b.GustKmhRaw -gt $gustNow)) { $gustNow = $b.GustKmhRaw }
    if ($null -ne $b.WindKmhRaw -and $null -eq $windNow) { $windNow = $b.WindKmhRaw }
    if ($null -ne $b.WaveMRaw -and ($null -eq $waveNow -or $b.WaveMRaw -gt $waveNow)) { $waveNow = $b.WaveMRaw }
}

$guide = Get-CanoeGuidance -WindKmh $windNow -GustKmh $gustNow -WaveM $waveNow -MarineWarning $hasMarineWarning

Write-Host ''
Write-Host 'CANOEING GUIDANCE (informal)'
Write-Host ('-' * 72)
Write-Host ("  Rating:   {0}" -f $guide.Rank)
Write-Host ("  Why:      {0}" -f $guide.Detail)
Write-Host '  Rubric:   GOOD = light wind, low chop, sheltered route'
Write-Host '            MARGINAL = some gusts or exposed shoreline'
Write-Host '            AVOID = strong gusts, whitecaps, building rain / warning'
Write-Host '  Local tip: Abino Bay is partly sheltered by Point Abino; west/SW'
Write-Host '             winds load the open lake - east/NE winds are often kinder.'

Write-Host ''
Write-Host "SOURCES (free, no API key)"
Write-Host ('-' * 72)
Write-Host '  Open-Meteo forecast ..... https://api.open-meteo.com'
Write-Host '  Open-Meteo marine ....... https://marine-api.open-meteo.com'
Write-Host '  EC marine (Lake Erie) ... https://api.weather.gc.ca/collections/marineweather-realtime'
Write-Host '  EC weather alerts ....... https://api.weather.gc.ca/collections/weather-alerts'
Write-Host '  NDBC buoy realtime ...... https://www.ndbc.noaa.gov/data/realtime2/'
Write-Host '  EC Eastern Lake Erie .... https://weather.gc.ca/marine/forecast_e.html?mapID=11&siteID=07503'
Write-Host '  Not used (key/blocked) .. AccuWeather, Surfline'

if ($errors.Count -gt 0) {
    Write-Host ''
    Write-Host 'FETCH WARNINGS'
    Write-Host ('-' * 72)
    foreach ($e in $errors) { Write-Host "  ! $e" }
}

Write-Host ''
Write-Host 'Done.'
Write-Host ''
