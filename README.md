# Roku WASD Remote

A modern Windows desktop Roku remote built for keyboard-first control.

## Features

- Finds Roku devices on the local network with Roku ECP / SSDP.
- Manual IP connect for TVs that do not answer discovery.
- WASD navigation: `W` up, `A` left, `S` down, `D` right.
- Gaming-style shortcuts: `Enter` / `Space` select, `Esc` / `Backspace` back, `H` home, `P` play, `Q` / `E` seek.
- Wake action sends Roku `PowerOn` and Wake-on-LAN when the Roku exposes a MAC address.
- Text box sends typed text to the focused Roku field.
- Portable Windows `.exe` build script.

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
