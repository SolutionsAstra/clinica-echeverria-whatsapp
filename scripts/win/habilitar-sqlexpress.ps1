#Requires -RunAsAdministrator
<#
  habilitar-sqlexpress.ps1 — Deja una instancia de SQL Server Express lista para el backend Astra:
    - TCP/IP habilitado en un puerto FIJO (src/db.js no usa instanceName ni SQL Browser)
    - Autenticación mixta (usuario/clave SQL, como espera el .env)
    - Login de desarrollo con rol dbcreator (db-bootstrap.js puede crear la base)
    - Opcional: regla de firewall SOLO para la red Tailscale (100.64.0.0/10)

  Ejecutar en Windows PowerShell 5.1 como Administrador:
    powershell -ExecutionPolicy Bypass -File scripts\win\habilitar-sqlexpress.ps1
#>
param(
  [string]$Instance = 'SQLEXPRESS',
  [int]$Port = 1433,
  [string]$Login = 'astra_dev',
  [string]$Password,
  [switch]$OpenFirewall
)
$ErrorActionPreference = 'Stop'

# 1) Localizar la instancia en el registro
$names = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL' -ErrorAction SilentlyContinue
if (-not $names -or -not $names.$Instance) { throw "No encuentro la instancia '$Instance'. ¿Instalaste SQL Server Express?" }
$id      = $names.$Instance                       # ej. MSSQL16.SQLEXPRESS
$base    = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$id\MSSQLServer"
$service = if ($Instance -eq 'MSSQLSERVER') { 'MSSQLSERVER' } else { "MSSQL`$$Instance" }
Write-Host "Instancia $Instance -> $id (servicio $service)"

# 2) ¿El puerto está reservado por Hyper-V/WSL o lo ocupa otro proceso?
$reserved = netsh interface ipv4 show excludedportrange protocol=tcp |
  Select-String '^\s*(\d+)\s+(\d+)' |
  ForEach-Object { ,@([int]$_.Matches[0].Groups[1].Value, [int]$_.Matches[0].Groups[2].Value) }
foreach ($r in $reserved) {
  if ($Port -ge $r[0] -and $Port -le $r[1]) {
    throw "El puerto $Port está en un rango reservado por Windows ($($r[0])-$($r[1])), típico de Hyper-V/WSL. Usa -Port 14330 y pon DB_PORT=14330."
  }
}
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $proc = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).ProcessName
  if ($proc -ne 'sqlservr') { throw "El puerto $Port lo usa '$proc' (PID $($listener.OwningProcess)). Ciérralo o usa otro -Port." }
}

# 3) TCP/IP con puerto fijo + modo mixto
$tcp = "$base\SuperSocketNetLib\Tcp"
Set-ItemProperty $tcp        -Name Enabled         -Value 1
Set-ItemProperty "$tcp\IPAll" -Name TcpDynamicPorts -Value ''
Set-ItemProperty "$tcp\IPAll" -Name TcpPort         -Value "$Port"
Set-ItemProperty $base       -Name LoginMode       -Value 2
Write-Host "Reiniciando $service ..."
Restart-Service -Name $service -Force

# 4) Login de desarrollo (conexión con tu usuario de Windows, que el instalador dejó como sysadmin)
if (-not $Password) {
  $secure   = Read-Host "Clave para el login '$Login'" -AsSecureString
  $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
$cs = "Server=localhost,$Port;Database=master;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=5"
$conn = $null
for ($i = 0; $i -lt 15 -and -not $conn; $i++) {
  try { $c = New-Object System.Data.SqlClient.SqlConnection $cs; $c.Open(); $conn = $c }
  catch { Start-Sleep -Seconds 2 }
}
if (-not $conn) { throw "SQL Server no respondió en localhost,$Port tras el reinicio. Revisa el Visor de eventos (Aplicación, origen MSSQL`$$Instance)." }

$cmd = $conn.CreateCommand()
$cmd.CommandText = @"
DECLARE @q NVARCHAR(MAX);
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = @login)
  SET @q = N'CREATE LOGIN ' + QUOTENAME(@login) + N' WITH PASSWORD = ' + QUOTENAME(@pwd, '''') + N', CHECK_POLICY = OFF';
ELSE
  SET @q = N'ALTER LOGIN '  + QUOTENAME(@login) + N' WITH PASSWORD = ' + QUOTENAME(@pwd, '''');
EXEC (@q);
SET @q = N'ALTER SERVER ROLE dbcreator ADD MEMBER ' + QUOTENAME(@login);
EXEC (@q);
"@
[void]$cmd.Parameters.AddWithValue('@login', $Login)
[void]$cmd.Parameters.AddWithValue('@pwd', $Password)
[void]$cmd.ExecuteNonQuery()
$conn.Close()
Write-Host "Login '$Login' listo (rol dbcreator)."

# 5) Firewall opcional: solo si OTRO equipo (tu socio) debe conectarse, y solo vía Tailscale
if ($OpenFirewall) {
  $rule = "Astra SQL $Port (Tailscale)"
  if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $Port `
      -RemoteAddress 100.64.0.0/10 -Action Allow | Out-Null
  }
  Write-Host "Firewall: $Port abierto solo para 100.64.0.0/10."
}

Write-Host "`nPon esto en tu .env:" -ForegroundColor Green
Write-Host "DB_SERVER=localhost`nDB_PORT=$Port`nDB_NAME=ClinicaEcheverria`nDB_USER=$Login`nDB_PASSWORD=<la clave que elegiste>`nDB_ENCRYPT=true`nDB_TRUST_CERT=true`nDB_SCHEMA=dbo"
