# Wails Desktop Build

This project uses Wails v2 to package the ECU Log Viewer as a native desktop
application for macOS and Windows. The frontend remains the existing static
HTML/CSS/JavaScript app and is embedded from `dist/` during production builds.

## Prerequisites

- Go 1.23+
- Node.js 18+
- Wails CLI v2:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Run the Wails doctor when setting up a new machine:

```bash
wails doctor
```

## Development

```bash
npm install
npm run wails:dev
```

`wails:dev` starts a lightweight local static server on `127.0.0.1:5173` and
opens the Wails desktop window against it.

## Production Builds

Build the current host platform:

```bash
npm run wails:build
```

Build a universal macOS app from macOS:

```bash
npm run wails:build:mac
```

Build a Windows x64 app/NSIS installer:

```bash
npm run wails:build:windows
```

Windows packaging is most reliable on Windows. Cross-compiling from macOS may
require additional C/C++ toolchain setup and WebView2 packaging support.

## Output

Wails places packaged applications under `build/bin/`.
