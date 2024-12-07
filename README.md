# ChristmasMicScript

This script works by using client RCON and reading the game console as well as interfacing with VLC Media Player using HTTP, this script is VAC free, it works using the same methods as Pazer's TF2 Bot Detector to interface with TF2 and does not do anything dangerous like injecting or hijacking.
### Dependencies

- Deno

- VLC Media Player

- Team Fortress 2

- npm rcon-srcds

- npm fast-xml-parser

- npm html-entities

### Instruction

- Running `deno install` command in the script directory will install the needed NPM dependencies

- Use VB-CABLE to pipe audio to TF2

- Demo support will be enabled for all servers in TF2

- Please configure all paths and launch options in the config.toml file

- Please remove any TF2 mods you have that may overwrite con_logfile (Some huds may do this, mastercomfig does not do this)

- I have used Mp3tag to set artist and title metadata

- I recommend using VLC's built in filters to apply range compression to the audio, low audio volumes sound very bad with Steam's voice, also using the equalizer can mitigate compression artifacts

### Binds
- VLCPAUSE
- VLCNEXT
- VLCPLAY
- VLCINFO
