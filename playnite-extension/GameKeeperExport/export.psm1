function GetMainMenuItems {
    param($menuArgs)

    $menuItem = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $menuItem.Description = "Export for GameKeeper"
    $menuItem.FunctionName = "ExportForGameKeeper"
    $menuItem.MenuSection = "@GameKeeper"
    
    return $menuItem
}

function ExportForGameKeeper {
    param($scriptMainMenuItemActionArgs)

    $exportPath = $PlayniteApi.Dialogs.SaveFile("JSON files|*.json")
    
    if ([string]::IsNullOrEmpty($exportPath)) {
        return
    }

    try {
        $allGames = $PlayniteApi.Database.Games
        
        $exportGames = @()
        
        foreach ($game in $allGames) {
            $exportGame = @{
                Id = $game.Id.ToString()
                Name = $game.Name
                Playtime = $game.Playtime
            }
            
            if ($game.Source) {
                $exportGame.Source = @{
                    Id = $game.Source.Id.ToString()
                    Name = $game.Source.Name
                }
            }
            
            if ($game.LastActivity) {
                $exportGame.LastActivity = Get-Date $game.LastActivity -Format "o"
            }
            
            if ($game.ReleaseDate -and $game.ReleaseDate.Date) {
                $exportGame.ReleaseDate = @{
                    ReleaseDate = Get-Date $game.ReleaseDate.Date -Format "yyyy-MM-dd"
                }
            }

            if ($game.Genres -and $game.Genres.Count -gt 0) {
                $exportGame.Genres = @()
                foreach ($genre in $game.Genres) {
                    $exportGame.Genres += @{
                        Id = $genre.Id.ToString()
                        Name = $genre.Name
                    }
                }
            }

            if ($game.CoverImage) {
                $exportGame.CoverImage = $game.CoverImage
            }

            $exportGames += $exportGame
        }

        $jsonContent = $exportGames | ConvertTo-Json -Depth 5
        [System.IO.File]::WriteAllText($exportPath, $jsonContent, [System.Text.Encoding]::UTF8)

        $fileSize = (Get-Item $exportPath).Length
        $fileSizeKB = [math]::Round($fileSize / 1KB, 2)

        $PlayniteApi.Dialogs.ShowMessage(
            "Exported $($exportGames.Count) games to:`n$exportPath`n`nFile size: $fileSizeKB KB",
            "GameKeeper Export Complete"
        )
    }
    catch {
        $PlayniteApi.Dialogs.ShowErrorMessage(
            "Failed to export games: $($_.Exception.Message)",
            "GameKeeper Export Error"
        )
    }
}
