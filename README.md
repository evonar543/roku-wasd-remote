# Roku WASD Remote

A modern Windows desktop Roku remote built for keyboard-first control.

## Features

- Finds Roku devices on the local network with Roku ECP / SSDP.
- Manual IP connect for TVs that do not answer discovery.
- WASD navigation: `W` up, `A` left, `S` down, `D` right.
- Gaming-style shortcuts: `Enter` / `Space` select, `Esc` / `Backspace` back, `H` home, `P` play, `Q` / `E` seek.
- Hold-to-repeat controls for directions, volume, channel, rewind, and fast-forward.
- Mouse/touch pad: click to select, drag/flick to move, mouse wheel to change volume.
- Live Windows voice controls with a local command grammar.
- Wake action sends Roku `PowerOn` and Wake-on-LAN when the Roku exposes a MAC address.
- Text box sends typed text to the focused Roku field.
- Portable Windows `.exe` build script.

## Voice Commands

Start voice mode in the app and say commands such as:

- `move down three`
- `go up`
- `pause`
- `power off`
- `power on`
- `volume down`
- `channel up two`
- `hdmi one`

Voice mode uses Windows Speech Recognition with a fixed Roku command grammar for fast local command matching.

## Build

```powershell
npm install
npm run check
npm run roku:dist
```

The portable app is written to:

```text
release\Roku-WASD-Remote-win32-x64\Roku WASD Remote.exe
```

## Run From Source

```powershell
npm install
npm run roku:start
```

The Roku and the PC must be on the same local network. If discovery does not find the TV, enter the Roku IP address manually.
