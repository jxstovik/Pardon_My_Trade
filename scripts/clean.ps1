if (Test-Path -LiteralPath "dist") {
  Remove-Item -LiteralPath "dist" -Recurse -Force
}
